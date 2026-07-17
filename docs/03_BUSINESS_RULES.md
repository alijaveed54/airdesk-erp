# Mysmar ERP
Business Rules Documentation

============================================================
DOCUMENT INFORMATION
============================================================

Document Name : Business Rules

Priority : HIGH

Status : Active

Purpose

This document defines all permanent business rules of Mysmar ERP.

No business rule should be changed without user approval.

============================================================
CUSTOMER MANAGEMENT
============================================================

Customer Identifier

Primary Identifier

Contact Number

Rules

• Customer search starts with Contact Number.

• Existing customer information should be reused.

• Duplicate customer records should be avoided.

• Customer details may be updated through the unified Edit Order page.

============================================================
ORDER MANAGEMENT
============================================================

Invoice

Invoice Number is permanent.

Invoice Number must never be edited.

Every Invoice belongs to one customer.

One Invoice

↓

Many Order Items

Order Items

Stored inside BS Order Entry.

Each item belongs to one invoice.

Each item references one product using SKU.

============================================================
PRODUCT MANAGEMENT
============================================================

Primary Identifier

SKU

Rules

SKU must remain unique.

Product Name is reference only.

Supplier information comes from Product master.

============================================================
SUPPLIER MANAGEMENT
============================================================

Supplier Identifier

Supplier Code

Rules

Supplier users can only access their own records.

Supplier Pending is calculated using:

Received in WH 1

Blank = Pending

Yes = Completed

Supplier Status

Sold Out

Ready

Pending

============================================================
ORDER STATUS FLOW
============================================================

Standard Workflow

Order Received

↓

Processing

↓

Ready

↓

Dispatch

↓

Delivered

Future

Returned

Cancelled

Replacement

============================================================
EDIT ORDER RULES
============================================================

Only ONE Edit Order page is allowed.

Editable

Customer

Address

Area

City

Items

Supplier

Quantity

Discount

VAT

Shipping

Advance Payment

Order Notes

Replacement

Non Editable

Invoice Number

============================================================
REPLACEMENT RULES
============================================================

Replacement orders should preserve original order history.

Replacement notes must remain attached to the order.

Replacement information should never overwrite original order information.

============================================================
DISPATCH RULES
============================================================

Dispatch requires:

Order Ready

Courier Assigned

Valid Order

Dispatch Date

Future

Tracking Number

Delivery Confirmation

============================================================
============================================================
REPORTING RULES
============================================================

General Rules

• Reports must always be read-only.
• Reports should never modify Airtable data.
• Reports should load summaries before detailed records.
• Excel export should be available whenever practical.
• Refresh button should reload live Airtable data.

------------------------------------------------------------

Courier Report

Rules

• Show dispatched orders only.
• Ignore orders without courier where required by report logic.
• Support date filtering based on Dispatch Date.
• Highlight old pending dispatches when applicable.

------------------------------------------------------------

Pending Report

Rules

• Show only active pending orders.
• Exclude completed orders.
• Exclude cancelled orders unless specifically requested.

------------------------------------------------------------

Supplier Pending Report

Rules

• Group by Supplier.
• Show pending quantities.
• Display ageing where applicable.
• Support Excel export.

------------------------------------------------------------

Store Summary Report

Rules

• Summary first.
• Totals must match Airtable.
• Avoid duplicate counting.

============================================================
PERMISSION RULES
============================================================

Admin

• Full system access.

Manager

• Operational access.
• No system administration unless granted.

Supplier

• Can view only assigned supplier records.
• Cannot access other suppliers.
• Cannot modify system settings.

Future Staff

• Permissions configurable from ERP Admin.

============================================================
INVENTORY RULES
============================================================

Future Module

Inventory will become the single source of stock availability.

Planned Features

• Stock In
• Stock Out
• Warehouse Transfer
• Current Stock
• Reserved Stock
• Damaged Stock
• Stock Adjustment

============================================================
PURCHASE RULES
============================================================

Future Module

Purchase Orders

↓

Supplier

↓

Goods Receive

↓

Inventory Update

↓

Invoice Matching

============================================================
FINANCE RULES
============================================================

Future Module

Planned Features

• Income
• Expenses
• Customer Payments
• Supplier Payments
• Profit Reports
• Tax Reports

============================================================
SECURITY RULES
============================================================

• Authentication required for all protected pages.
• Session must be validated before loading data.
• Permission checks before sensitive actions.
• Never expose Airtable credentials.
• Never trust client-side permissions alone.

============================================================
UI / UX RULES
============================================================

Permanent UI Standards

• Professional ERP appearance.
• Lightweight interface.
• Fast loading.
• Consistent spacing.
• Responsive layout.
• Minimal animations.
• Preserve existing UI unless user requests redesign.

============================================================
PERFORMANCE RULES
============================================================

Required Practices

• Server-side filtering.
• Pagination.
• Lazy image loading.
• Avoid unnecessary API calls.
• Reuse existing data where possible.
• Keep Airtable requests minimal.

============================================================
CHANGE MANAGEMENT RULES
============================================================

Before implementing any feature:

1. Check existing implementation.
2. Reuse existing code when possible.
3. Avoid duplicate functionality.
4. Preserve backward compatibility.
5. Test affected modules.

============================================================
AI OPERATING RULES
============================================================

Every AI working on this project must:

• Read PROJECT_MEMORY.md first.
• Follow database documentation.
• Follow API documentation.
• Respect business rules.
• Preserve existing architecture.
• Never invent Airtable field names.
• Never remove existing functionality without approval.

============================================================
LONG-TERM ROADMAP
============================================================

Phase 1

✔ Authentication

✔ Dashboard

✔ Orders

✔ Suppliers

Phase 2

• Edit Order
• Reports Completion

Phase 3

• Inventory
• Purchase

Phase 4

• Sales
• Finance

Phase 5

• HR
• Notifications
• WhatsApp Integration
• Analytics

============================================================
END OF FILE
============================================================