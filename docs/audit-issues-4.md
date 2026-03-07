# Heritage Splitter - Audit Round 4

**Date**: 2026-03-07
**Auditeur**: Claude Opus 4.6
**Scope**: Backend (Rust/Axum), Frontend (SolidJS/TS), Smart Contracts (Solidity)
**Contexte**: Quatrieme audit apres correction de 142 issues sur les trois rounds precedents

---

## Resume Global

| Severite | Backend | Frontend | Contracts | Total |
|----------|---------|----------|-----------|-------|
| CRITICAL | 1 | 0 | 0 | 1 |
| HIGH | 2 | 1 | 1 | 4 |
| MEDIUM | 1 | 8 | 2 | 11 |
| LOW | 0 | 1 | 2 | 3 |
| INFO | 0 | 0 | 2 | 2 |
| **Total** | **4** | **10** | **7** | **21** |

---

## BACKEND (Rust/Axum) - 4 issues

### CRITICAL

**B4-1 - Deploiement work bloque: mauvais check de status participant**
- Fichier: `backend/src/routes/works.rs:573-578`
- Le deploiement verifie `participants.iter().all(|p| p.status == "accepted")`. Mais dans le workflow d'approbation work, `approve_work_terms()` set `approved_at` SANS changer le `status` (qui reste `"invited"`). Resultat: le check echoue TOUJOURS, aucun work ne peut etre deploye apres approbation.

### HIGH

**B4-2 - Recompute shares manquant apres accept_invitation**
- Fichier: `backend/src/routes/participants.rs:321-355`
- `accept_invitation()` change le status a `"accepted"` mais n'appelle PAS `recompute_allocation_shares()`. En mode equal, les shares restent basees sur l'ancien nombre de participants acceptes.

**B4-3 - Recompute shares manquant dans bot auto-accept**
- Fichier: `backend/src/routes/participants.rs:280-308`
- Le task async qui auto-accepte les bots ne fait pas non plus de recompute. Meme impact que B4-2.

### MEDIUM

**B4-4 - creator_shares_bps sans .max(0) defensif**
- Fichier: `backend/src/routes/works.rs:212,553`
- `10000 - total_alloc_bps` n'utilise pas `.max(0)` contrairement au calcul projet (ligne 130). Si la validation est bypassee, underflow possible. Risque faible mais inconsistance.

---

## FRONTEND (SolidJS/TypeScript) - 10 issues

### HIGH

**F4-1 - Type cast unsafe sur window.ethereum dans PublicSale**
- Fichier: `frontend/src/pages/PublicSale.tsx:115-117`
- Le cast est trop loose. Le check `typeof ethereum?.request === 'function'` existe ligne 118 mais arrive APRES le cast. Si l'objet ethereum est malformed entre les deux lignes (theorique), crash possible.

### MEDIUM

**F4-2 - Avatar non sanitise dans Navbar**
- Fichier: `frontend/src/components/ui/Navbar.tsx:91`
- `user()!.avatar_url` rendu directement en `<img src>` sans `sanitizeImageUrl()`. Un SVG malveillant pourrait etre execute.

**F4-3 - Avatar non sanitise dans ShareAllocator**
- Fichier: `frontend/src/components/project/ShareAllocator.tsx:612-613`
- Les avatars des participants ne passent pas par `sanitizeImageUrl()`.

**F4-4 - Avatar non sanitise dans Activity.tsx**
- Fichier: `frontend/src/pages/Activity.tsx:352-354,397-398`
- Avatars de conversations et messages non sanitises.

**F4-5 - Avatar non sanitise dans ProjectDiscussion.tsx**
- Fichier: `frontend/src/pages/project/ProjectDiscussion.tsx:366-367,520-521,579-580`
- Avatars dans les mentions et messages non sanitises.

**F4-6 - Image NFT non sanitisee dans WorkNfts.tsx**
- Fichier: `frontend/src/pages/project/WorkNfts.tsx:703`
- `image_url` des NFTs rendu directement dans le modal sans `sanitizeImageUrl()`.

**F4-7 - Image NFT non sanitisee dans PublicSale.tsx**
- Fichier: `frontend/src/pages/PublicSale.tsx:486,614-615,674-675`
- `image_url` des NFTs dans la grille et le modal sans sanitisation.

**F4-8 - Race condition polling + WebSocket dans ProjectDiscussion**
- Fichier: `frontend/src/pages/project/ProjectDiscussion.tsx:83-99`
- Le polling et le WebSocket peuvent tous les deux trigger `loadMessages()` simultanement, causant des doublons de messages ou des race conditions.

**F4-9 - getUnreadCount erreur silencieuse dans Navbar**
- Fichier: `frontend/src/components/ui/Navbar.tsx:16,24`
- `api.getUnreadCount().catch(() => {})` avale silencieusement les erreurs. Le badge de notifications ne se met plus a jour si le backend a des problemes.

### LOW

**F4-10 - Avatar non sanitise dans ProjectCard.tsx**
- Fichier: `frontend/src/components/project/ProjectCard.tsx`
- Logo projet potentiellement non sanitise.

---

## SMART CONTRACTS (Solidity) - 7 issues

### HIGH

**S4-1 - Pas de tests pour les limites batch (101 items)**
- Fichier: `blockchain/test/HeritageNFT.t.sol`, `blockchain/test/HeritageVault.t.sol`
- Les `require(length <= 100)` dans mintBatch, burnBatch, setPriceBatch n'ont aucun test verifiant le revert a 101 items. Une regression pourrait passer inapercue.

### MEDIUM

**S4-2 - Pas de limite max beneficiaires dans HeritageSplitter**
- Fichier: `blockchain/src/HeritageSplitter.sol:43-72`
- Le constructeur accepte un nombre illimite de beneficiaires. Le check O(n2) de doublons + la boucle dans `receive()` pourraient depasser la gas limit avec >50 beneficiaires.

**S4-3 - Pas de tests pour listAvailableTokens paginee**
- Fichier: `blockchain/test/HeritageVault.t.sol`
- La version `listAvailableTokens(offset, limit)` n'a aucun test : offset=0, offset milieu, offset > total, limit > 1000.

### LOW

**S4-4 - Pas de test pour revokeMinter**
- Fichier: `blockchain/test/HeritageNFT.t.sol`
- Aucun test verifiant qu'apres `revokeMinter()`, le minter ne peut plus minter.

**S4-5 - Pas de test claimRefund accumulation**
- Fichier: `blockchain/test/HeritageVault.t.sol`
- Pas de test pour multiple overpayments suivis d'un seul claimRefund.

### INFO

**S4-6 - Limite batch 100 non documentee en NatSpec**
- Fichier: `blockchain/src/HeritageNFT.sol:87-102`, `blockchain/src/HeritageVault.sol:116-126`
- Les `require(length <= 100)` ne sont pas mentionnes dans les commentaires NatSpec des fonctions.

**S4-7 - Pagination listAvailableTokens non documentee**
- Fichier: `blockchain/src/HeritageVault.sol:160-178`
- Pas de NatSpec sur le comportement avec offset excessif ou limit > 1000.
