# Heritage Splitter - Audit Round 5

**Date**: 2026-03-07
**Auditeur**: Claude Opus 4.6
**Scope**: Backend (Rust/Axum), Frontend (SolidJS/TS), Smart Contracts (Solidity)
**Contexte**: Cinquieme audit apres correction de 163 issues sur les quatre rounds precedents

---

## Resume Global

| Severite | Backend | Frontend | Contracts | Total |
|----------|---------|----------|-----------|-------|
| HIGH | 0 | 1 | 1 | 2 |
| MEDIUM | 2 | 0 | 1 | 3 |
| LOW | 3 | 1 | 0 | 4 |
| **Total** | **5** | **2** | **2** | **9** |

---

## BACKEND (Rust/Axum) - 5 issues

### MEDIUM

**B5-1 - create_work_allocation: pas de validation distribution_mode**
- Fichier: `backend/src/routes/works.rs:870-941`
- Le endpoint `create_work_allocation` n'a aucune validation du champ `distribution_mode`. Contrairement a `create_allocation` (allocations.rs:65-67) qui rejette les valeurs autres que "equal"/"custom", une valeur arbitraire (ex: "bogus") est acceptee. Cela cause des dysfonctionnements en cascade: `recompute_equal_shares` retourne early, et le deploy echoue de maniere confuse.

**B5-2 - public_slug: collision possible sans contrainte UNIQUE**
- Fichier: `backend/src/routes/works.rs:1499-1517`, `backend/src/db/mod.rs:256`
- `publish_work` genere un slug avec seulement 16 bits de randomness (65536 possibilites) via `gen_range(0u16..=0xFFFFu16)`. Aucune contrainte UNIQUE sur `public_slug` en DB, aucun check de collision. Deux oeuvres avec le meme nom peuvent produire le meme slug, et `get_public_collection` retournerait les donnees de la mauvaise oeuvre.

### LOW

**B5-3 - create_work_allocation: max_slots sans borne superieure**
- Fichier: `backend/src/routes/works.rs:896-900`
- Valide `max_slots > 0` mais pas la borne max de 1000 que `create_allocation` (allocations.rs:52-54) enforce. Inconsistance entre les deux endpoints.

**B5-4 - deploy_work: pas de validation des adresses de config**
- Fichier: `backend/src/routes/works.rs:512-668`
- `deploy_work` utilise `state.config.factory_address` et `registry_address` qui defaultent a "" si les env vars ne sont pas set. Le `Address::from_str("")` echouera APRES le changement de status a "deploying". Le rollback async se lance mais le state transition est inutile.

**B5-5 - Race condition submit_work_for_approval vs auto_reset_on_nft_change**
- Fichier: `backend/src/routes/works.rs:296-459, 1098-1123`
- `submit_work_for_approval` fait des updates non-transactionnelles (reset approved_at puis change status). Entre les deux, un appel concurrent a `create_draft_nft` peut trigger `auto_reset_on_nft_change` qui reset a "draft". Le bot auto-approve peut ensuite agir sur un work deja reset.

---

## FRONTEND (SolidJS/TypeScript) - 2 issues

### HIGH

**F5-1 - Adresse DocumentRegistry hardcodee incorrecte**
- Fichier: `frontend/src/pages/project/ProjectDocuments.tsx:125`, `frontend/src/pages/VerifyDocument.tsx:192`
- L'adresse `0xD14D15F06FBf547362a8A89B25eF1AeEA8ED02bB` hardcodee dans le domain EIP-712 ne correspond PAS au contrat deploye (`0x2876e2E97d62A837ed38645fd0B648d0502c878d`). La certification de documents est completement cassee: la signature sera rejetee on-chain car le domain separator ne matche pas.

### LOW

**F5-2 - Bypass validation type fichier quand file.type est vide**
- Fichier: `frontend/src/lib/api-client.ts:324`
- Le check `file.type && !ALLOWED_TYPES.includes(file.type)` skip la validation si `file.type` est une string vide (ce qui arrive pour certaines extensions comme .md, .csv). Un fichier de type inconnu bypass le filtre client.

---

## SMART CONTRACTS (Solidity) - 2 issues

### HIGH

**S5-1 - rescueETH draine les pendingRefunds des acheteurs**
- Fichier: `blockchain/src/HeritageVault.sol:216-223`
- `rescueETH` envoie `address(this).balance` en entier. Mais le balance peut inclure des ETH stockes dans `pendingRefunds` (overpayments non reclames). Le producteur peut (involontairement ou non) voler les refunds des acheteurs. Fix: tracker `totalPendingRefunds` et soustraire du montant rescuable.

### MEDIUM

**S5-2 - Storage gap off-by-one dans PaymentRegistry**
- Fichier: `blockchain/src/PaymentRegistry.sol:140-144`
- Le gap `uint256[46]` suppose 4 slots utilises, mais `ReentrancyGuard._status` occupe le slot 0 (5 slots au total). Le gap devrait etre `uint256[45]` pour un total de 50. Risque de collision de storage lors d'un upgrade futur.
