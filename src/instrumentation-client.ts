import { installHistoryGuard } from "@/lib/history-guard";

// Next 16.3 runs this before hydration: register the legacy history guard before
// App Router can consume a traversal and unmount unsaved task editors.
installHistoryGuard();
