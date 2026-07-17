# Mysmar ERP
Database Documentation

============================================================
DOCUMENT INFORMATION
============================================================

Document Name : DATABASE

Priority : HIGH

Database Engine : Airtable

Status : Active

============================================================
DATABASE OVERVIEW
============================================================

Mysmar ERP currently uses Airtable as its primary database.

The database is divided into multiple bases.

Current architecture separates:

• ERP Administration

• Operational Data

Future versions will support additional company bases without code changes.

============================================================
DATABASE DESIGN PRINCIPLES
============================================================

Primary Rules

• Never rename Airtable fields without approval.

• Never delete existing fields.

• Prefer adding new fields instead of changing old ones.

• SKU is the primary product identifier.

• Contact Number is the primary customer identifier.

• Bill Number links invoices and order items.

============================================================
DATABASE FLOW
============================================================

Customer

↓

BS Invoice

↓

BS Order Entry

↓

Products

↓

Reports

============================================================
TABLES
============================================================

Current Tables

• Customers

• BS Invoice

• BS Order Entry

• Products

• ERP Users

• ERP Base Access

• ERP Permissions

Additional tables may be added in future.

============================================================
TABLE
============================================================

Customers

Purpose

Stores master customer information.

Primary Identifier

Contact Number

Main Fields

Customer Name

Contact No

Address

Area Name

City Name

Remarks (future)

Status (future)

Relationships

One Customer

↓

Many Invoices

Validation

Contact Number should be unique whenever possible.

Customer Name should never be empty.

============================================================
TABLE
============================================================

BS Invoice

Purpose

Stores order header.

Primary Identifier

Invoice Number

Important Fields

Invoice Number

Customer

Contact Number

Store

Order Status

Courier

Shipping

VAT

Discount

Advance Payment

Order Date

Dispatch Date

Order Notes

Replacement Notes

Relationships

One Invoice

↓

Many Order Items

Validation

Invoice Number must never change.

Customer reference should always exist.

============================================================
TABLE
============================================================

BS Order Entry

Purpose

Stores every product belonging to an invoice.

Primary Identifier

Combination of

Bill Number

+

SKU

Important Fields

Bill Number

SKU

Supplier

Supplier Code

Quantity

Selling Price

Purchase Price

Received in WH 1

Item Code

Relationships

Many Items

↓

One Invoice

Many Items

↓

One Product

Validation

SKU should always exist.

Quantity must be greater than zero.

============================================================
TABLE
============================================================

Products

Purpose

Master product catalogue.

Approximate Records

30000+

Primary Identifier

SKU

Important Fields

SKU

Product Name

Supplier

Supplier Code

Image

Category

Purchase Price

Selling Price

Status

Relationships

One Product

↓

Many Order Items

Validation

SKU must remain unique.

Product Name should never be empty.
============================================================
TABLE
============================================================

ERP Users

Purpose

Stores all ERP login users.

Primary Identifier

User ID

Main Fields

• User Name
• Login ID / Email
• Password (Never stored in plain text)
• Role
• Status
• Default Base
• Last Login
• Created At
• Updated At

Relationships

One User

↓

One Role

↓

One or More Base Access Records

Validation

• User Name is required.
• Login ID must be unique.
• Role is mandatory.
• Inactive users cannot log in.

============================================================
TABLE
============================================================

ERP Base Access

Purpose

Controls which Airtable Base(s) each user can access.

Main Fields

• User
• Base Name
• Base ID
• Access Status
• Default Base

Relationships

One User

↓

Many Base Access Records

Validation

• Base Name must exist.
• Disabled access blocks login to that base.

============================================================
TABLE
============================================================

ERP Permissions

Purpose

Stores feature-level permissions.

Main Fields

• User
• Role
• Module
• Can View
• Can Create
• Can Edit
• Can Delete
• Can Export

Relationships

One User

↓

Many Permission Records

Business Rule

Permissions should always override menu visibility.

============================================================
RELATIONSHIP MAP
============================================================

Customers

↓

BS Invoice

↓

BS Order Entry

↓

Products

------------------------------------------------------------

ERP Users

↓

ERP Base Access

↓

ERP Permissions

============================================================
LOOKUP FIELDS
============================================================

Current Lookups

Customer

↓

Invoice

Product

↓

Order Entry

Supplier

↓

Order Entry

Future Lookups

Store

Courier

Warehouse

Salesperson

============================================================
FIELD NAMING RULES
============================================================

Rules

• Never rename existing Airtable fields.

• Use existing names exactly.

• Avoid duplicate fields.

• Prefer descriptive names.

• Preserve capitalization.

Examples

Correct

Contact No

Area Name

City Name

Supplier Code

Received in WH 1

Incorrect

Phone

City

Area

SupplierCode

WarehouseReceived

============================================================
DATA VALIDATION RULES
============================================================

Customer

• Contact Number required.

Invoice

• Invoice Number required.

• Customer required.

Order Entry

• SKU required.

• Quantity > 0.

Products

• SKU required.

• Product Name required.

Users

• Login ID required.

• Role required.

============================================================
DATA INTEGRITY RULES
============================================================

Never create orphan records.

Every Order Item must belong to an Invoice.

Every Invoice should reference a Customer.

Every SKU should exist in Products.

Never allow duplicate Invoice Numbers.

Never allow duplicate SKU values in Products.

============================================================
PERFORMANCE GUIDELINES
============================================================

Large Tables

Products

Approx. 30,000+ records

Guidelines

• Always filter server-side.

• Never load all records unnecessarily.

• Use pagination wherever possible.

• Load images only on demand.

• Avoid repeated Airtable requests.

============================================================
BACKUP STRATEGY
============================================================

Recommended

• Airtable snapshot before major schema changes.

• Export critical tables before bulk updates.

• Never change production schema without testing.

============================================================
FUTURE DATABASE MODULES
============================================================

Planned Tables

• Inventory
• Warehouses
• Purchase Orders
• Purchase Items
• Sales Returns
• Stock Transfers
• Courier Tracking
• Payment Records
• Expense Ledger
• Audit Logs
• Notification Queue
• WhatsApp Logs

============================================================
DATABASE CHANGE POLICY
============================================================

Before modifying the database:

1. Review existing schema.

2. Check dependencies.

3. Confirm field names.

4. Test API compatibility.

5. Preserve backward compatibility.

============================================================
AI INSTRUCTIONS
============================================================

When working with the database:

• Treat Airtable as the source of operational data.

• Never invent field names.

• Never assume relationships.

• Reuse existing schema whenever possible.

• If a required field is missing, ask before creating a new one.

============================================================
END OF FILE
============================================================