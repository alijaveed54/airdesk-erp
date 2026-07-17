# Mysmar ERP
Airtable Field Mapping

============================================================
DOCUMENT INFORMATION
============================================================

Purpose

Central reference for every Airtable field.

Never rename fields without updating this document.

============================================================
TABLE
============================================================

Customers

| Field | Purpose | Used In |
|-------|----------|---------|
| Customer Name | Customer Name | Orders, Edit Order |
| Contact No | Customer Lookup | Customer Search API |
| Address | Delivery Address | Orders |
| Area Name | Delivery Area | Orders |
| City Name | Delivery City | Orders |

============================================================
TABLE
============================================================

BS Invoice

| Field | Purpose | Used In |
|-------|----------|---------|
| Invoice Number | Primary Invoice | Orders |
| Customer | Customer Link | Orders |
| Order Status | Workflow Status | Reports |
| Store | Store Name | Reports |
| Courier | Courier | Courier Report |
| Shipping | Shipping Charges | Edit Order |
| VAT | Tax | Edit Order |
| Discount | Discount | Edit Order |
| Advance Payment | Advance | Edit Order |
| Dispatch Date | Dispatch | Courier Report |
| Order Notes | Notes | Edit Order |

============================================================
TABLE
============================================================

BS Order Entry

| Field | Purpose | Used In |
|-------|----------|---------|
| Bill No | Invoice Link | Orders |
| SKU | Product Link | Products |
| Supplier | Supplier | Supplier Pending |
| Supplier Code | Supplier Filter | Supplier APIs |
| Quantity | Qty | Orders |
| Item Code | Product Code | Products |
| Received in WH 1 | Warehouse Status | Pending Logic |

============================================================
TABLE
============================================================

Products

| Field | Purpose | Used In |
|-------|----------|---------|
| SKU | Primary Key | Entire ERP |
| Product Name | Display Name | Orders |
| Supplier | Supplier | Supplier Pending |
| Supplier Code | Filter | Reports |
| Image | Product Image | Orders |
| Purchase Price | Cost | Future Profit |
| Selling Price | Sale Price | Orders |

============================================================
FIELD RULES
============================================================

Never Rename

✔ SKU

✔ Contact No

✔ Supplier Code

✔ Received in WH 1

✔ Invoice Number

============================================================
SAFE TO ADD
============================================================

New fields may be added.

Existing fields should never be renamed.

============================================================
FUTURE TABLES
============================================================

Inventory

Purchase

Sales

Finance

Warehouse

Audit Log

============================================================
END OF FILE
============================================================