# Mysmar ERP
Master Project Memory
============================================================

Document Priority : HIGHEST
Project Status    : Active Development
Framework         : Next.js 16 (App Router)
Language          : TypeScript
Database          : Airtable
Hosting           : Vercel (Planned)

This document is the PRIMARY SOURCE OF TRUTH for the entire project.

Every new AI assistant MUST read this document completely before making any changes.

If any information inside this document conflicts with memory or assumptions, THIS DOCUMENT ALWAYS WINS.

============================================================
PROJECT OVERVIEW
============================================================

Project Name

Mysmar ERP

Purpose

Mysmar ERP is a complete business management system designed to manage multi-company operations using Airtable as the backend and Next.js as the frontend.

The ERP is intended to replace manual workflows by integrating order management, customer management, supplier management, inventory tracking, reporting, dispatch handling, permissions, and future accounting modules into one unified platform.

The system is designed with scalability in mind and should support multiple Airtable bases in future.

============================================================
PRIMARY OBJECTIVES
============================================================

The ERP should provide:

• Fast order processing

• Supplier management

• Inventory control

• Customer management

• Reporting

• Dispatch workflow

• Authentication

• Permission based access

• Multi-company support

• Base selection

• Expandable architecture

============================================================
CURRENT DEVELOPMENT STATUS
============================================================

Overall Progress

Approximately 55–60%

Completed

✔ Authentication

✔ Login System

✔ Dashboard

✔ Orders List

✔ Order Search

✔ Pagination

✔ Supplier Pending Module

✔ Grouped Orders

✔ Reports (Initial)

✔ Base Authentication

✔ Permission Foundation

In Progress

• Edit Order

• Reports Improvements

• User Management

Pending

• Inventory

• Purchase

• Sales

• Finance

• HR

• Notifications

• WhatsApp Integration

• Audit Logs

• Multi Warehouse

============================================================
TECH STACK
============================================================

Frontend

Next.js 16

React

TypeScript

TailwindCSS

Backend

Next.js API Routes

Database

Airtable

Authentication

Cookie Based Session

Future Hosting

Vercel

Development Environment

Visual Studio Code

Node.js

============================================================
PROJECT ARCHITECTURE
============================================================

Architecture Style

App Router

API Driven

Component Based

Database Layer

Airtable

Presentation Layer

Next.js

Business Layer

API Routes

============================================================
IMPORTANT DEVELOPMENT RULES
============================================================

These rules are PERMANENT.

Never ignore them.

Rule 1

Every ERP response MUST begin with

[DD Mon YYYY | HH:MM AM/PM PKT]

Rule 2

Always mention FULL FILE PATH before code.

Rule 3

Never send incomplete patches.

Whenever possible provide ready-to-replace code.

Rule 4

Never redesign UI unless requested.

Rule 5

Performance has higher priority than animations.

Rule 6

Avoid unnecessary re-rendering.

Rule 7

Prefer server-side filtering when possible.

Rule 8

Never change database field names without confirmation.

Rule 9

Never remove existing features while adding new ones.

Rule 10

Always preserve backward compatibility.

============================================================
USER PREFERENCES
============================================================

The project owner prefers:

• Complete patch files

• Full file paths

• Less explanation

• More code

• Lightweight UI

• Fast loading

• Professional interface

• Green / Blue ERP theme

• Step-by-step development

• Existing code modification instead of unnecessary rewrites

• Excel export preferred

• Read-only reports where possible

• Single Edit workflow

• No duplicated pages

============================================================
PROJECT DEVELOPMENT ORDER
============================================================

Authentication

↓

Dashboard

↓

Orders

↓

Grouped Orders

↓

Supplier Pending

↓

Edit Order

↓

Reports

↓

Inventory

↓

Purchase

↓

Sales

↓

Accounting

↓

HR

↓

Analytics

============================================================
CURRENT PROJECT STRUCTURE
============================================================

Main Framework

Next.js App Router

Primary Folder

app/

Dashboard

app/(dashboard)/

Authentication

app/auth/

API

app/api/

Components

components/

Library

lib/

Utilities

utils/

============================================================
CURRENT MODULES
============================================================

Authentication

Status

Completed

Purpose

Login users

Manage session

Validate permissions

Current State

Stable

------------------------------------------------------------

Dashboard

Status

Completed

Purpose

Landing page

Quick statistics

Navigation

Current State

Stable

------------------------------------------------------------

Orders

Status

Completed

Features

Pagination

Search

Filters

Load More

View

Supplier Integration

Performance Optimized

Current State

Stable

------------------------------------------------------------

Supplier Pending

Status

Completed

Features

Supplier grouping

Bulk dispatch

Bulk stock out

Refresh

Excel Export

Image popup

Checkbox selection

Current State

Stable

------------------------------------------------------------

Grouped Orders

Status

Completed

Purpose

Group same order items

Performance

Images load on demand

Current State

Stable

------------------------------------------------------------

Reports

Status

Partial

Current Reports

Courier

Pending

Store Wise

Supplier Pending

Month Wise COD

Needs additional optimization.

============================================================
============================================================
DATABASE ARCHITECTURE
============================================================

Database Engine

Airtable

Current Design

The ERP uses multiple Airtable Bases.

Current production architecture separates operational data from ERP administration.

Future architecture will support additional company bases without changing application logic.

------------------------------------------------------------
MAIN TABLES
------------------------------------------------------------

Customers

Purpose

Stores customer master information.

Common Fields

• Customer Name
• Contact No.
• Address
• Area Name
• City Name

------------------------------------------------------------

BS Invoice

Purpose

Stores order header.

Contains

• Invoice Number
• Customer
• Store
• Order Status
• Courier
• Shipping
• VAT
• Discount
• Advance Payment
• Order Date
• Dispatch Date
• Notes

------------------------------------------------------------

BS Order Entry

Purpose

Stores every item inside an order.

Contains

• Bill No
• SKU
• Quantity
• Supplier
• Supplier Code
• Item Code
• Selling Price
• Purchase Price
• Received in WH 1
• Status

------------------------------------------------------------

Products

Purpose

Master product catalogue.

Approximate Records

30,000+

Contains

• SKU

• Product Name

• Supplier

• Supplier Code

• Image

• Category

• Purchase Price

• Selling Price

------------------------------------------------------------

ERP Admin Base

Purpose

Authentication

Permissions

Users

Base Access

Future System Settings

============================================================
DATABASE RELATIONSHIPS
============================================================

Customer

↓

BS Invoice

↓

BS Order Entry

↓

Products

------------------------------------------------------------

Customer Lookup

Contact Number

------------------------------------------------------------

Invoice Lookup

Bill Number

------------------------------------------------------------

Product Lookup

SKU

============================================================
CURRENT API STRUCTURE
============================================================

API Folder

app/api/

Current APIs

Customers

Products

Orders

Supplier

Stores

Grouped Orders

Authentication

Reports

Permissions

============================================================
IMPORTANT FILES
============================================================

Authentication

app/auth/login/

------------------------------------------------------------

Dashboard

app/(dashboard)/dashboard/

------------------------------------------------------------

Orders

app/(dashboard)/orders/

------------------------------------------------------------

Grouped Orders

app/(dashboard)/orders/grouped/

------------------------------------------------------------

Supplier Pending

app/(dashboard)/suppliers/

------------------------------------------------------------

Reports

app/(dashboard)/reports/

------------------------------------------------------------

API

app/api/

------------------------------------------------------------

Components

components/

------------------------------------------------------------

Library

lib/

============================================================
AUTHENTICATION
============================================================

Authentication Method

Cookie Session

Current Status

Working

Completed

✔ Login

✔ Session

✔ Logout

✔ Protected Routes

Pending

Role Expansion

User Management

Password Reset

============================================================
PERMISSION SYSTEM
============================================================

Roles

Admin

Manager

Supplier

Future

Staff

------------------------------------------------------------

Admin

Full Access

------------------------------------------------------------

Manager

Operational Access

------------------------------------------------------------

Supplier

Can only see assigned supplier data.

Must never have access to unrelated supplier orders.

============================================================
ORDER WORKFLOW
============================================================

Customer Places Order

↓

Order Created

↓

BS Invoice Created

↓

BS Order Entry Created

↓

Supplier Allocation

↓

Supplier Dispatch

↓

Warehouse Receive

↓

Courier Dispatch

↓

Delivered

============================================================
EDIT ORDER PHILOSOPHY
============================================================

Only ONE Edit Order page will exist.

It must support editing:

Customer Information

Invoice Information

Order Items

Supplier

Shipping

VAT

Discount

Advance Payment

Replacement

Order Notes

Totals

No duplicate edit pages should ever be created.

============================================================
PERFORMANCE PHILOSOPHY
============================================================

Performance is always preferred over visual effects.

Required Optimizations

Lazy Loading

Pagination

Minimal Re-render

Image On Demand

Read-only Reports

Small API Responses

Avoid unnecessary database reads.

============================================================
REPORTING MODULE
============================================================

Existing Reports

Courier Report

Pending Report

Supplier Pending Report

Store Summary

Month Wise COD

Every report should support

Excel Export

Refresh

Fast Loading

Summary View

Future Reports

Profit Report

Purchase Report

Inventory Report

Customer Report

Supplier Ledger

Sales Analysis

============================================================

============================================================
BUSINESS RULES
============================================================

Customer

• Customer search is primarily based on Contact Number.
• Existing customer information should populate automatically where possible.
• Customer details may be edited from the unified Edit Order page.

------------------------------------------------------------

Orders

• Invoice Number must remain non-editable.
• Every order belongs to one invoice.
• One invoice can contain multiple order items.
• Order items are stored separately from the invoice header.

------------------------------------------------------------

Products

• SKU is the primary product identifier.
• Products are linked to order items using SKU.
• Product Name is reference information and should not be edited from orders.

------------------------------------------------------------

Suppliers

• Supplier Code identifies supplier ownership.
• Supplier users should only access their own assigned records.
• "Received in WH 1" uses only:
    - Blank
    - Yes

------------------------------------------------------------

Dispatch

Dispatch workflow:

Order Received
↓

Processing
↓

Ready
↓

Dispatch
↓

Delivered

------------------------------------------------------------

Replacement Orders

Replacement is controlled from Edit Order.

Replacement information must be preserved in Order Notes.

============================================================
PERMANENT DEVELOPMENT DECISIONS
============================================================

The following decisions must never be changed without user approval.

• Single Edit Order page only.
• Full file replacement preferred over code snippets.
• Always include full file paths.
• Every ERP response begins with PKT timestamp.
• Lightweight UI.
• Fast loading over animations.
• Reports should support Excel export.
• Read-only reporting whenever possible.
• Avoid duplicate pages.
• Preserve Airtable field names.
• Never redesign working modules unnecessarily.

============================================================
KNOWN ISSUES HISTORY
============================================================

Resolved

✔ Login routing issues

✔ Middleware redirect issues

✔ Supplier Pending filtering

✔ Orders pagination

✔ Dashboard authentication

✔ Grouped Orders image loading

✔ Store Summary mismatch

✔ Courier report filtering

✔ Supplier page refresh

✔ Product search improvements

Pending

• Unified Edit Order completion

• Additional permission refinement

• Future inventory implementation

============================================================
CURRENT MODULE STATUS
============================================================

Authentication

████████████████████ 100%

Dashboard

████████████████████ 100%

Orders

████████████████████ 100%

Grouped Orders

████████████████████ 100%

Supplier Pending

████████████████████ 100%

Reports

██████████████------ 70%

Edit Order

██████████████------ 90%

Inventory

-------------------- 0%

Purchase

-------------------- 0%

Finance

-------------------- 0%

HR

-------------------- 0%

============================================================
NEXT DEVELOPMENT ROADMAP
============================================================

Priority 1

Complete Edit Order

Priority 2

Complete Reports

Priority 3

Inventory

Priority 4

Purchase Module

Priority 5

Sales Module

Priority 6

Finance

Priority 7

HR

Priority 8

Analytics

Priority 9

Notifications

Priority 10

WhatsApp Integration

============================================================
GENERAL CODING STANDARDS
============================================================

• Use TypeScript.

• Keep code modular.

• Reuse components.

• Avoid duplicated logic.

• API routes should perform validation.

• Handle loading states.

• Handle errors gracefully.

• Prefer async/await.

• Maintain backward compatibility.

============================================================
AI INSTRUCTIONS
============================================================

Any AI continuing this project MUST:

1.
Read this document completely before writing code.

2.
Read the remaining files inside /docs.

3.
Treat PROJECT_MEMORY.md as the highest priority document.

4.
Never ask the user to repeat documented information.

5.
Preserve architecture.

6.
Preserve coding style.

7.
Preserve business rules.

8.
Preserve Airtable field names.

9.
Do not redesign modules without user approval.

10.
Always continue from the latest pending task.

============================================================
NEVER FORGET
============================================================

• Full File Paths are mandatory.

• PKT Timestamp required for ERP responses.

• User prefers complete patch files.

• Performance is more important than animations.

• Do not break existing functionality.

• Airtable is the single source of operational data.

• Reports should include Excel export where practical.

• Supplier access must remain restricted.

• Single Edit Order page philosophy.

============================================================
CONTINUATION PROMPT
============================================================

If this project is opened in a new ChatGPT conversation:

1.
Read PROJECT_MEMORY.md completely.

2.
Read all remaining documentation files.

3.
Treat the documentation as the project's source of truth.

4.
Do not ask the user to repeat already documented information.

5.
Continue from the latest pending task.

6.
If documentation conflicts with code, report the conflict before making changes.

============================================================
END OF FILE
============================================================