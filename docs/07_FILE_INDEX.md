# Mysmar ERP
Complete File Index

============================================================
DOCUMENT INFORMATION
============================================================

Purpose

This document indexes every important file in the project.

Whenever a new file is added,
this document MUST be updated.

============================================================
PROJECT ROOT
============================================================

Root Folder

/

Contains

Application

Documentation

Configuration

============================================================
DOCUMENTATION
============================================================

Path

/docs/

Files

00_PROJECT_MEMORY.md

Purpose

Master Project Brain

Priority

★★★★★

------------------------------------------------------------

01_DATABASE.md

Purpose

Database Documentation

Priority

★★★★★

------------------------------------------------------------

02_APIS.md

Purpose

API Documentation

Priority

★★★★★

------------------------------------------------------------

03_BUSINESS_RULES.md

Purpose

ERP SOP

Priority

★★★★★

------------------------------------------------------------

04_COMPLETED.md

Purpose

Completed Work

Priority

★★★★☆

------------------------------------------------------------

05_PENDING.md

Purpose

Future Development

Priority

★★★★★

------------------------------------------------------------

06_CHANGELOG.md

Purpose

Version History

Priority

★★★★☆

============================================================
APP DIRECTORY
============================================================

Path

/app/

Purpose

Next.js App Router

Contains

Dashboard

Authentication

API

Layouts

============================================================
AUTHENTICATION
============================================================

Path

app/auth/

Purpose

Authentication

Contains

Login

Logout

Session

Status

Completed

============================================================
DASHBOARD
============================================================

Path

app/(dashboard)/dashboard/

Purpose

Dashboard

Status

Completed

============================================================
ORDERS
============================================================

Path

app/(dashboard)/orders/

Purpose

Order Management

Contains

Orders List

View

Edit

Grouped Orders

Status

Active

============================================================
SUPPLIERS
============================================================

Path

app/(dashboard)/suppliers/

Purpose

Supplier Pending

Supplier Operations

Status

Completed

============================================================
REPORTS
============================================================

Path

app/(dashboard)/reports/

Purpose

ERP Reports

Contains

Courier

Pending

Supplier

Store Summary

COD

Status

Partial

============================================================
API DIRECTORY
============================================================

Path

app/api/

Purpose

Backend APIs

Contains

Authentication

Customers

Orders

Products

Suppliers

Reports

Options

============================================================
COMPONENTS
============================================================

Path

/components/

Purpose

Reusable Components

Examples

Sidebar

Navbar

Cards

Tables

Dialogs

Forms

============================================================
LIBRARY
============================================================

Path

/llb/

Purpose

Database Helpers

Utilities

Airtable Connection

============================================================
UTILITIES
============================================================

Path

/utlls/

Purpose

Common Helper Functions

Formatting

Calculations

Validation

============================================================
CONFIG FILES
============================================================

Typical Files

package.json

tsconfig.json

next.config

tailwind.config

eslint.config

============================================================
FILE NAMING RULES
============================================================

Use

page.tsx

route.ts

layout.tsx

loading.tsx

error.tsx

Avoid

Random filenames

Duplicate files

Unused files

============================================================
AI RULES
============================================================

Before editing any file

1.

Read PROJECT_MEMORY.md

2.

Locate file here

3.

Understand dependencies

4.

Modify existing file whenever possible

============================================================
END OF FILE
============================================================