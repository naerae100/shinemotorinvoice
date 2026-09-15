import re

with open('frontend/src/components/documents/InvoiceDocument.jsx', 'r') as f:
    content = f.read()

# Close TotalsBlock immediately after the props
content = content.replace(
    """total={formatNumber(invoice.total, 2)}\n      >""",
    """total={formatNumber(invoice.total, 2)}\n      />"""
)

# Remove the closing </TotalsBlock> tag
content = content.replace("</TotalsBlock>\n", "")

with open('frontend/src/components/documents/InvoiceDocument.jsx', 'w') as f:
    f.write(content)
