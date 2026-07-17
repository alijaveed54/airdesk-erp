# Mysmar ERP
Release Checklist

============================================================
DOCUMENT INFORMATION
============================================================

Purpose

This checklist must be completed before every production release.

Rules

• Never deploy without completing this checklist.
• Every failed check must be resolved before release.
• Record release version after deployment.

============================================================
PRE-RELEASE
============================================================

Project

☐ Code committed

☐ Latest backup created

☐ Documentation updated

☐ Version number updated

☐ CHANGELOG updated

☐ Pending tasks reviewed

============================================================
DATABASE
============================================================

☐ Airtable backup created

☐ No field names changed

☐ No broken relationships

☐ Lookup fields verified

☐ Rollups verified

☐ New fields documented

☐ Test records removed

============================================================
AUTHENTICATION
============================================================

☐ Login working

☐ Logout working

☐ Session validation working

☐ Protected routes verified

☐ Permission checks verified

☐ Admin login tested

☐ Supplier login tested

☒ Manager login tested

============================================================
ORDERS
============================================================

☐ Orders List loads

☐ Search working

☐ Pagination working

☐ Load More working

☐ View Order working

☐ Edit Order working

☐ Grouped Orders working

============================================================
CUSTOMERS
============================================================

☐ Customer Search

☐ Existing Customer Lookup

☐ Customer Update

☐ Address Update

☐ Area Update

☐ City Update

============================================================
PRODUCTS
============================================================

☐ SKU Search

☐ Product Lookup

☐ Supplier Lookup

☐ Image Loading

============================================================
SUPPLIERS
============================================================

☐ Pending Items

☐ Bulk Dispatch

☐ Bulk Stock Out

☐ Refresh

☐ Excel Export

============================================================
REPORTS
============================================================

☐ Courier Report

☐ Pending Report

☐ Supplier Pending

☐ Store Summary

☐ COD Report

☐ Totals Verified

☐ Excel Export

============================================================
APIs
============================================================

☐ Authentication APIs

☐ Customer APIs

☐ Product APIs

☐ Order APIs

☐ Supplier APIs

☐ Report APIs

☐ Options APIs

============================================================
UI
============================================================

☐ Responsive

☐ No broken layout

☐ No console errors

☐ Loading indicators

☐ Error messages

☐ Buttons working

============================================================
PERFORMANCE
============================================================

☐ Pagination verified

☐ Lazy Loading verified

☐ No unnecessary API calls

☐ Reports optimized

☐ Images optimized

============================================================
SECURITY
============================================================

☐ Unauthorized access blocked

☐ Supplier isolation verified

☐ Admin permissions verified

☐ Sensitive routes protected

☐ Secrets not exposed

============================================================
FINAL TEST
============================================================

☐ Create Order

☐ Edit Order

☐ Dispatch Order

☐ Supplier Workflow

☐ Report Verification

☐ Login/Logout

☐ Refresh Browser

☐ Production Build Success

============================================================
DEPLOYMENT
============================================================

☐ npm run build

☐ Build Successful

☐ Deploy to Vercel

☐ Verify Environment Variables

☐ Verify Production Login

☐ Verify Production APIs

============================================================
POST RELEASE
============================================================

Release Version

_____________________

Release Date

_____________________

Released By

_____________________

Notes

______________________________________________________

______________________________________________________

============================================================
END OF FILE
============================================================