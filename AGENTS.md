Keep the Vite browser client and standalone Worker separate so B2 secrets never enter the browser bundle.
Use D1 only for metadata; B2 stores all binary content.
Authenticate all API operations with the operator token and do not persist that token in browser storage.
