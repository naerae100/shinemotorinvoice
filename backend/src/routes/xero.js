import { Router } from 'express';
import { XeroClient } from 'xero-node';
import { prisma } from '../config/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Create the XeroClient without secrets initially.
// We will initialize it with secrets inside the route handlers
// to ensure it always uses the latest environment variables (especially on Vercel).
const getXeroClient = () => {
  return new XeroClient({
    clientId: process.env.XERO_CLIENT_ID || '',
    clientSecret: process.env.XERO_CLIENT_SECRET || '',
    redirectUris: [
      process.env.NODE_ENV === 'production'
        ? 'https://shinemotorinvoice.vercel.app/api/xero/callback'
        : 'http://localhost:5173/api/xero/callback',
    ],
    scopes: 'openid profile email accounting.transactions accounting.contacts offline_access'.split(' '),
  });
};

// GET /api/xero/status
router.get(
  '/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    const settings = await prisma.companySettings.findUnique({
      where: { id: 'singleton' },
    });

    if (!settings || !settings.xeroTenantId || !settings.xeroAccessToken) {
      return res.json({ connected: false });
    }

    res.json({ connected: true, tenantId: settings.xeroTenantId });
  })
);

// GET /api/xero/connect
router.get(
  '/connect',
  requireAuth,
  asyncHandler(async (req, res) => {
    const xero = getXeroClient();
    if (!xero.clientId) {
      return res.status(400).send('Xero Client ID is not configured on the server.');
    }

    const consentUrl = await xero.buildConsentUrl();
    res.redirect(consentUrl);
  })
);

// GET /api/xero/callback
// Note: This is an unauthenticated callback route because Xero redirects the user's browser here.
router.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const { code } = req.query;
    if (!code) {
      return res.status(400).send('No code returned from Xero.');
    }

    const xero = getXeroClient();
    try {
      const tokenSet = await xero.apiCallback(req.url);
      await xero.updateTenants();

      const activeTenant = xero.tenants[0];
      if (!activeTenant) {
        return res.status(400).send('No Xero tenant found.');
      }

      await prisma.companySettings.upsert({
        where: { id: 'singleton' },
        update: {
          xeroTenantId: activeTenant.tenantId,
          xeroAccessToken: tokenSet.access_token,
          xeroRefreshToken: tokenSet.refresh_token,
          xeroTokenExpiresAt: new Date(tokenSet.expires_at * 1000),
        },
        create: {
          id: 'singleton',
          xeroTenantId: activeTenant.tenantId,
          xeroAccessToken: tokenSet.access_token,
          xeroRefreshToken: tokenSet.refresh_token,
          xeroTokenExpiresAt: new Date(tokenSet.expires_at * 1000),
        },
      });

      // Redirect back to the settings page in the frontend
      res.redirect('/settings?xero=success');
    } catch (e) {
      console.error('Xero OAuth Error:', e);
      res.status(500).send('Failed to authenticate with Xero.');
    }
  })
);

/**
 * Utility function to get an authenticated XeroClient.
 * It will automatically refresh the token if it is expired.
 */
export const getAuthenticatedXeroClient = async () => {
  const settings = await prisma.companySettings.findUnique({
    where: { id: 'singleton' },
  });

  if (!settings || !settings.xeroTenantId || !settings.xeroAccessToken) {
    return null; // Not connected
  }

  const xero = getXeroClient();
  xero.setTokenSet({
    access_token: settings.xeroAccessToken,
    refresh_token: settings.xeroRefreshToken,
    expires_at: Math.floor(settings.xeroTokenExpiresAt.getTime() / 1000),
  });

  // Check if token is expired (or expires within 60 seconds)
  if (settings.xeroTokenExpiresAt.getTime() - Date.now() < 60000) {
    try {
      const validTokenSet = await xero.refreshToken();
      await prisma.companySettings.update({
        where: { id: 'singleton' },
        data: {
          xeroAccessToken: validTokenSet.access_token,
          xeroRefreshToken: validTokenSet.refresh_token,
          xeroTokenExpiresAt: new Date(validTokenSet.expires_at * 1000),
        },
      });
      xero.setTokenSet(validTokenSet);
    } catch (e) {
      console.error('Failed to refresh Xero token', e);
      return null;
    }
  }

  return { xero, tenantId: settings.xeroTenantId };
};

/**
 * Push a purchase docket to Xero as a Draft Bill (ACCPAY)
 */
export const pushPurchaseDocketToXero = async (docket) => {
  const connection = await getAuthenticatedXeroClient();
  if (!connection) return null; // Not connected

  const { xero, tenantId } = connection;

  const lineItems = docket.lineItems.map(li => ({
    // A docket line may be a one-off grade typed straight in, with no material
    // behind it — reading .description first is what stops that crashing.
    Description: li.description || li.material?.description || 'Scrap metal',
    Quantity: Number(li.netWeight),
    UnitAmount: Number(li.price),
    // For Purchases, we don't strictly need AccountCode if they just want Drafts,
    // but typically it maps to Cost of Goods Sold. We'll let Xero defaults handle it.
  }));

  // If there's a discount, add it as a negative line item
  if (Number(docket.discountAmount) > 0) {
    lineItems.push({
      Description: 'Discount',
      Quantity: 1,
      UnitAmount: -Number(docket.discountAmount),
    });
  }

  // Map our taxMode to Xero's LineAmountTypes
  const xeroTaxMode = (mode) => ({
    EXCLUSIVE: 'Exclusive',
    INCLUSIVE: 'Inclusive',
    NO_TAX: 'NoTax',
  })[mode] || 'Exclusive';

  const invoice = {
    Type: 'ACCPAY', // Accounts Payable (Bill)
    LineAmountTypes: xeroTaxMode(docket.taxMode),
    Contact: {
      Name: docket.supplier.name,
    },
    Date: docket.date.toISOString().split('T')[0],
    DueDate: docket.date.toISOString().split('T')[0], // Due same day by default
    LineItems: lineItems,
    InvoiceNumber: `DOC-${docket.docketNumber}`,
    Reference: docket.docketNumber.toString(),
    Status: 'DRAFT',
  };

  try {
    const response = await xero.accountingApi.createInvoices(tenantId, {
      invoices: [invoice]
    });
    const xeroInvoiceId = response.body.invoices[0].invoiceID;
    
    // Save the Xero ID back to our docket
    await prisma.docket.update({
      where: { id: docket.id },
      data: { xeroInvoiceId },
    });
    
    return xeroInvoiceId;
  } catch (error) {
    console.error('Failed to push to Xero:', error.response?.body || error.message);
    return null;
  }
};

/**
 * Push an export invoice to Xero as a Draft Sales Invoice (ACCREC)
 */
export const pushSalesInvoiceToXero = async (invoiceData) => {
  const connection = await getAuthenticatedXeroClient();
  if (!connection) return null; // Not connected

  const { xero, tenantId } = connection;

  // A line may be a one-off typed straight onto the invoice, with no material
  // behind it, so the typed description comes first and the material is the
  // fallback rather than the other way round.
  const lineItems = invoiceData.lineItems.map(li => ({
    Description: li.description || li.material?.description || 'Goods',
    Quantity: Number(li.netWeightMt),
    UnitAmount: Number(li.pricePerMt),
  }));

  if (Number(invoiceData.discountAmount) > 0) {
    lineItems.push({
      Description: 'Discount',
      Quantity: 1,
      UnitAmount: -Number(invoiceData.discountAmount),
    });
  }

  const invoice = {
    Type: 'ACCREC', // Accounts Receivable (Sales Invoice)
    // Without this Xero books the amounts in the organisation's base currency,
    // so a USD invoice would land as the same number of Australian dollars.
    CurrencyCode: invoiceData.currency || 'AUD',
    Contact: {
      Name: invoiceData.consignee.name,
    },
    Date: invoiceData.date.toISOString().split('T')[0],
    DueDate: invoiceData.date.toISOString().split('T')[0],
    LineItems: lineItems,
    InvoiceNumber: invoiceData.invoiceNumber,
    Reference: invoiceData.poNumber || invoiceData.contractNo || '',
    Status: 'DRAFT',
  };

  try {
    const response = await xero.accountingApi.createInvoices(tenantId, {
      invoices: [invoice]
    });
    const xeroInvoiceId = response.body.invoices[0].invoiceID;
    
    await prisma.exportInvoice.update({
      where: { id: invoiceData.id },
      data: { xeroInvoiceId },
    });
    
    return xeroInvoiceId;
  } catch (error) {
    console.error('Failed to push Sales Invoice to Xero:', error.response?.body || error.message);
    return null;
  }
};

export default router;
