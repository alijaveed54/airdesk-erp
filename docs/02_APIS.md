# Mysmar ERP
API Documentation

============================================================
DOCUMENT INFORMATION
============================================================

Document Name : APIs

Priority : HIGH

Framework : Next.js API Routes

Language : TypeScript

Database : Airtable

Status : Active

============================================================
API DESIGN PRINCIPLES
============================================================

All APIs must follow these rules:

• Use TypeScript.
• Validate input before processing.
• Return proper HTTP status codes.
• Never expose Airtable secrets.
• Return JSON responses only.
• Handle errors gracefully.
• Avoid duplicate Airtable requests.
• Prefer server-side filtering.
• Keep responses lightweight.

============================================================
API STRUCTURE
============================================================

Root

app/api/

Current API Categories

Authentication

Customers

Products

Orders

Grouped Orders

Suppliers

Reports

Options

Future Modules

Inventory

Purchase

Sales

Finance

Notifications

============================================================
AUTHENTICATION APIs
============================================================

Purpose

User Login

Session Validation

Permission Check

Logout

Responsibilities

• Validate credentials.
• Load user permissions.
• Determine accessible Airtable base.
• Create authenticated session.
• Reject unauthorized users.

Response

Success

User

Role

Base

Session

Failure

401 Unauthorized

403 Forbidden

500 Server Error

============================================================
CUSTOMER APIs
============================================================

Purpose

Customer search

Customer lookup

Customer autofill

Typical Route

app/api/customers/

Responsibilities

• Search customer by Contact Number.
• Return customer details.
• Support auto-complete.
• Prevent unnecessary duplicate lookups.

Input

Contact Number

Output

Customer Name

Address

Area

City

Validation

Contact Number required.

============================================================
PRODUCT APIs
============================================================

Purpose

Product Search

Product Lookup

Supplier Information

Typical Route

app/api/products/

Responsibilities

• Search by SKU.
• Search by Item Code.
• Search by Product Name (where supported).
• Return product details.

Output

SKU

Product Name

Supplier

Supplier Code

Image

Category

Status

Validation

SKU preferred as primary identifier.

============================================================
ORDER APIs
============================================================

Purpose

Order Management

Responsibilities

• Create Order

• View Order

• Edit Order

• Search Order

• Pagination

• Filters

• Order Summary

Current Features

Load More

Search

Grouping

Status Filtering

Future

Bulk Edit

Bulk Delete

Order Timeline

============================================================
GROUPED ORDER APIs
============================================================

Purpose

Group invoice items together.

Responsibilities

• Group by Bill Number.

• Return grouped items.

• Load product images only when requested.

Performance Rules

Never preload all images.

Use lazy loading whenever possible.

============================================================
SUPPLIER APIs
============================================================

Purpose

Supplier Pending

Supplier Dispatch

Supplier Summary

Responsibilities

• Supplier filtering.

• Pending calculation.

• Bulk Dispatch.

• Stock Out.

• Refresh.

Validation

Supplier Code required.

============================================================
REPORT APIs
============================================================

Purpose

Generate reports.

Current Reports

Courier

Pending

Supplier Pending

Store Summary

Month Wise COD

Future Reports

Inventory

Profit

Purchase

Sales

Finance

Performance Rule

Reports should return summary data whenever possible.
============================================================
API STANDARDS
============================================================

Request Format

JSON

Response Format

JSON

Error Format

{
    "success": false,
    "message": "Error Description"
}

Success Format

{
    "success": true,
    "data": {}
}

============================================================
CUSTOMER SEARCH API
============================================================

Route

app/api/customers/search/route.ts

Method

GET

Purpose

Search customer using Contact Number.

Input

contact

Output

Customer Name

Contact Number

Address

Area Name

City Name

Validation

Contact Number is required.

Dependencies

lib/airtable.ts

Used By

Orders

Edit Order

Customer Search

============================================================
PRODUCT SEARCH API
============================================================

Route

app/api/products/route.ts

Method

GET

Purpose

Search products.

Supported Search

SKU

Item Code

Product Name (where available)

Output

SKU

Product Name

Supplier

Supplier Code

Image

Validation

Search text required.

Dependencies

lib/airtable.ts

============================================================
ORDER APIs
============================================================

Purpose

Manage Orders

Operations

Create

Read

Update

Search

Pagination

Grouping

Dispatch

Future

Delete

Audit Trail

============================================================
GROUPED ORDER API
============================================================

Purpose

Return grouped order items.

Rules

Group by Bill Number.

Images loaded on demand.

Dependencies

Products

BS Invoice

BS Order Entry

============================================================
SUPPLIER PENDING API
============================================================

Purpose

Generate supplier pending list.

Rules

Received in WH 1

Blank = Pending

Yes = Completed

Output

Supplier

Bill Number

SKU

Quantity

Status

============================================================
REPORT APIs
============================================================

Courier Report

Pending Report

Supplier Pending

Store Summary

COD Report

Rules

Fast

Read Only

Excel Export

============================================================
OPTIONS APIs
============================================================

Purpose

Populate dropdowns.

Examples

Stores

Cities

Suppliers

Order Status

Rules

Return complete option list.

============================================================
ERROR HANDLING
============================================================

Use

400

Bad Request

401

Unauthorized

403

Forbidden

404

Not Found

500

Server Error

============================================================
SECURITY RULES
============================================================

• Never expose Airtable API Key.

• Validate all inputs.

• Reject invalid requests.

• Check permissions before sensitive operations.

============================================================
PERFORMANCE RULES
============================================================

• Server-side filtering.

• Pagination.

• Avoid repeated Airtable requests.

• Lazy image loading.

• Lightweight responses.

============================================================
FUTURE APIs
============================================================

Inventory

Purchase

Sales

Warehouse

Finance

Notifications

WhatsApp

Analytics

============================================================
END OF FILE
============================================================