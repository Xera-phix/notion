# Skill Observations

No observations recorded yet.

### Observation 1: Browser smoke tests catch render-path regressions that builds miss
- **Context:** While adding ordered inline private comments, the production build passed even though the rendered notes loop referenced an index that was no longer in scope.
- **Signal:** Opening the page in a browser immediately produced `ReferenceError: index is not defined`; the same smoke test also exposed that local prefixed IDs could not be inserted into Supabase UUID columns.
- **Reusable lesson:** For React changes involving list rendering and persistence, pair static validation with a browser path that renders the affected view, creates the new entity, reloads it, and checks the persisted ordering. Treat local IDs and database IDs as separate contracts at repository boundaries.
- **Status:** OPEN
