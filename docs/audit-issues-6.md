# Heritage Splitter - Audit Round 6

**Date**: 2026-03-07
**Auditeur**: Claude Opus 4.6
**Scope**: Backend (Rust/Axum), Frontend (SolidJS/TS), Smart Contracts (Solidity)
**Contexte**: Sixieme audit apres correction de 172 issues sur les cinq rounds precedents

---

## Resume Global

| Severite | Backend | Frontend | Contracts | Total |
|----------|---------|----------|-----------|-------|
| MEDIUM | 0 | 2 | 0 | 2 |
| **Total** | **0** | **2** | **0** | **2** |

---

## BACKEND (Rust/Axum) - 0 issues

Aucune issue trouvee. Le backend est clean.

---

## FRONTEND (SolidJS/TypeScript) - 2 issues

### MEDIUM

**F6-1 - Avatar non sanitise dans ProjectOverview.tsx**
- Fichier: `frontend/src/pages/project/ProjectOverview.tsx:193,257`
- `u.avatar_url` et `getAvatar(p.user_id)` rendus directement dans `<img src>` sans `sanitizeImageUrl()`.
- **CORRIGE** dans ce round.

**F6-2 - Logo non sanitise dans ProjectLayout.tsx**
- Fichier: `frontend/src/pages/project/ProjectLayout.tsx:175`
- `p().logo_url` rendu directement dans `<img src>` sans `sanitizeImageUrl()`.
- **CORRIGE** dans ce round.

---

## SMART CONTRACTS (Solidity) - 0 issues

Aucune issue trouvee. Les smart contracts sont clean.
