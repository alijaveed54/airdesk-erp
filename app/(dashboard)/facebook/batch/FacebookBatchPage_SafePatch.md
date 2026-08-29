# SAFE PATCH ONLY

File to modify:
`C:\airdesk-erp\app\(dashboard)\facebook\batch\page.tsx`

DO NOT REPLACE THE WHOLE FILE.
Only add the following two changes.

## STEP 1

Add this import at the top with other imports:

```tsx
import FacebookBatchProductModule from "./components/FacebookBatchProductModule";
```

## STEP 2

Add this component inside the existing return JSX.
Recommended location: after page heading/header and before existing batch creation area.

```tsx
<FacebookBatchProductModule />
```

Keep all existing code unchanged:

- image upload
- R2 upload
- groups/posts
- queue
- scheduling
