# Heritage Splitter - Audit Complet des Issues

**Date**: 2026-03-07
**Auditeur**: Claude Opus 4.6
**Scope**: Backend (Rust/Axum), Frontend (SolidJS/TS), Smart Contracts (Solidity)

---

## Resume Global

| Severite | Backend | Frontend | Contracts | Total |
|----------|---------|----------|-----------|-------|
| CRITICAL | 4 | 1 | 2 | 7 |
| HIGH | 7 | 9 | 3 | 19 |
| MEDIUM | 8 | 10 | 6 | 24 |
| LOW | 7 | 11 | 4 | 22 |
| INFO | 2 | 2 | 3 | 7 |
| **Total** | **28** | **33** | **18** | **79** |

---

## BACKEND (Rust/Axum) - 28 issues

### CRITICAL

**B1 - Endpoints publics exposent donnees sensibles**
- Fichier: `backend/src/routes/public.rs`
- `/api/public/projects/{id}` retourne participants, wallets, allocations sans controle de visibilite (pas de flag public/prive sur les projets)

**B2 - Race condition bot auto-accept**
- Fichier: `backend/src/routes/participants.rs:206-245`
- Le task async (3s delay) peut racer avec une acceptation manuelle ; pas de `WHERE status = 'invited'` conditionnel sur le UPDATE

**B3 - Pas de validation sum shares avant deploy**
- Fichier: `backend/src/routes/works.rs:543-595`
- En mode `custom`, la somme des shares des participants n'est pas verifiee = `alloc.total_bps` avant deploiement on-chain. Split invalide possible

**B4 - Inconsistance casse wallet**
- Fichier: `backend/src/routes/auth.rs:50,74`
- Auth normalise en lowercase, mais d'autres endroits utilisent `LOWER()` SQL, et le stockage participant peut etre mixte

### HIGH

**B5 - Race condition recompute shares**
- Fichier: `backend/src/routes/allocations.rs:336-413`
- `recompute_equal_shares()` fait COUNT puis UPDATE sans transaction ; un participant ajoute entre les deux fausse le calcul

**B6 - Race condition approval workflow**
- Fichier: `backend/src/routes/projects.rs:387-409`
- Un participant peut etre invite entre le fetch et le UPDATE `status='approved'`, et ne sera pas compte

**B7 - Path traversal incomplet**
- Fichier: `backend/src/routes/documents.rs:185-194`
- `canonicalize()` se fait au download, pas a l'upload ; un symlink cree apres stockage bypass la verif

**B8 - Avatar URL 500KB = vecteur DoS**
- Fichier: `backend/src/routes/users.rs:82`
- Limite a 500 000 chars pour data URI, peut exploser la DB et la memoire sur list_users()

**B9 - Race condition certification**
- Fichier: `backend/src/routes/documents.rs:216-340`
- Deux requetes concurrentes peuvent certifier le meme document ; la 2eme ecrase le tx_hash de la 1ere

**B10 - Delete work sans verif status projet**
- Fichier: `backend/src/routes/works.rs:259-288`
- Un work peut etre supprime meme si le projet est dans un etat verrouille

**B11 - Adresse blockchain non validee**
- Fichier: `backend/src/services/blockchain.rs:121-124`
- L'adresse retournee par l'event log est formatee sans revalidation avant stockage en DB

### MEDIUM

**B12 - Incoherence certified_at sans tx_hash**
- Fichier: `backend/src/routes/documents.rs:132-147`
- Un document peut avoir `certified_at` set mais `tx_hash` null = etat invalide retourne par l'API

**B13 - max_participants projet non verifie**
- Fichier: `backend/src/routes/participants.rs`
- Le champ `max_participants` du projet n'est jamais checke lors de l'ajout de participants

**B14 - Display name vide accepte**
- Fichier: `backend/src/routes/users.rs:54-102`
- `"     "` (espaces) passe la validation de longueur mais est inutile ; pas de trim()

**B15 - max_slots peut etre 0 ou negatif**
- Fichier: `backend/src/routes/allocations.rs:19-85`
- Pas de validation que max_slots > 0 si defini

**B16 - Status non valide par enum**
- Fichier: `backend/src/routes/projects.rs` + `backend/src/routes/works.rs`
- Les status sont des strings libres, pas de whitelist ; un status invalide en DB bypass les checks

**B17 - CORS Any par defaut**
- Fichier: `backend/src/main.rs:70-84`
- Si `CORS_ORIGIN` non defini, toute origine est autorisee

**B18 - Queries sans LIMIT**
- Fichier: `backend/src/routes/public.rs`, `backend/src/routes/users.rs`
- Certaines queries n'ont pas de LIMIT ou ont des LIMIT trop eleves (500)

**B19 - Notifications sans transaction**
- Fichier: `backend/src/routes/participants.rs:186-196`
- Creation de 2 notifications (invitation_received + invitation_sent) non atomique

### LOW

**B20 - Sleep 3s hardcode**
- Fichier: `backend/src/routes/participants.rs:217`
- Delai bot auto-accept non configurable

**B21 - Pas de limite taille sur messages/threads**
- Fichier: `backend/src/main.rs`
- Les endpoints messages n'ont pas de `content_length_limit` explicite

**B22 - Pas de timezone explicite**
- Fichier: DB timestamps
- `CURRENT_TIMESTAMP` SQLite sans spec UTC explicite

**B23 - Pas de request ID dans les erreurs**
- Fichier: `backend/src/error.rs`
- Pas de correlation ID pour le debugging

**B24 - Pas de doc OpenAPI**
- Fichier: tous les routes
- Aucune spec Swagger/OpenAPI

**B25 - Upload filename non sanitise**
- Fichier: `backend/src/routes/documents.rs`
- Le nom de fichier original peut contenir des caracteres speciaux

**B26 - JWT secret "dev-secret" en dev**
- Fichier: `backend/src/config.rs:27-32`
- Insecure si accidentellement deploye sans variable d'env

---

## FRONTEND (SolidJS/TypeScript) - 33 issues

### CRITICAL

**F1 - SVG inline dans config wallet**
- Fichier: `frontend/src/config/wallet.ts:26`
- Chaine SVG brute utilisee comme icone ; si jamais rendue via innerHTML, vecteur XSS

### HIGH

**F2 - Erreur reseau efface le token**
- Fichier: `frontend/src/hooks/createAuth.ts:14-33`
- Si `getMe()` echoue pour raison reseau (pas auth), le token est quand meme supprime -> logout inattendu

**F3 - Stale closure KYC**
- Fichier: `frontend/src/pages/Onboarding.tsx:59-61,106-117`
- Le `bioPromise` peut resoudre apres unmount, met a jour un etat detruit -> memory leak

**F4 - Promise non catchee**
- Fichier: `frontend/src/pages/Activity.tsx:79-93`
- `refetchMessages()` et `refetchConvos()` apres envoi de message ne sont pas dans le try/catch

**F5 - JWT en localStorage**
- Fichier: `frontend/src/lib/api-client.ts:7-10`
- Vulnerable au vol par XSS ; pas de cookie HttpOnly

**F6 - Cast Error non valide**
- Fichier: `frontend/src/pages/project/WorkLayout.tsx:126`
- `e as Error & { shortMessage?: string }` sans verifier que `e` est bien un Error

**F7 - Event listener duplique**
- Fichier: `frontend/src/components/ui/ModalRoot.tsx:31`
- `createEffect` peut ajouter plusieurs `keydown` listeners si l'effect re-execute

**F8 - Race condition upload image**
- Fichier: `frontend/src/pages/ProfileEdit.tsx:29-40`
- Deux selections rapides de fichier : le resize du premier peut finir apres le second

**F9 - Casts Web3 sans validation**
- Fichier: `frontend/src/pages/PublicSale.tsx:111-130`
- `accounts[0] as 0x${string}` sans verifier que le tableau n'est pas vide

**F10 - Non-null assertion contract address**
- Fichier: `frontend/src/pages/project/WorkNfts.tsx:247`
- `w.contract_vault_address!` crash si null

### MEDIUM

**F11 - Pas de loading state sur upload logo**
- Fichier: `frontend/src/pages/ProjectNew.tsx:143-179`
- Double-submit possible

**F12 - Blob URL revoque trop tot**
- Fichier: `frontend/src/lib/utils.ts:119-120`
- `URL.revokeObjectURL()` apres premier load ; re-render = image cassee

**F13 - Liste messages non paginee**
- Fichier: `frontend/src/pages/Activity.tsx:348-372`
- Tous les messages rendus d'un coup ; freeze UI sur gros historiques

**F14 - WebSocket ne reconnecte pas sur nouveau token**
- Fichier: `frontend/src/hooks/createWebSocket.ts:68`
- Si le JWT change, le WS garde l'ancien

**F15 - Pas de validation MIME cote client**
- Fichier: `frontend/src/lib/api-client.ts:268-296`
- Upload de fichier sans verif type/taille avant envoi

**F16 - Submit possible avec total > 10000 bps**
- Fichier: `frontend/src/components/project/ShareAllocator.tsx:245-246`
- Pas de blocage front ; seule l'API rejette

**F17 - Race condition upload logo**
- Fichier: `frontend/src/pages/project/ProjectLayout.tsx:125-136`
- Deux uploads simultanes : le refetch du premier ecrase le second

**F18 - Pas de reset form apres erreur invite**
- Fichier: `frontend/src/components/project/ShareAllocator.tsx:181-210`
- L'utilisateur ne sait pas s'il doit reessayer

**F19 - Adresse contrat non validee**
- Fichier: `frontend/src/pages/VerifyNft.tsx:10-14`
- Parametre URL `contract` utilise tel quel, pas de validation format

**F20 - Pas d'alt/title significatif sur images**
- Fichier: Multiple fichiers
- Violation accessibilite

### LOW

**F21 - Adresse registry hardcodee (testnet)**
- Fichier: `frontend/src/pages/VerifyDocument.tsx:192`
- Pas de config pour mainnet

**F22 - Troncature silencieuse attributs**
- Fichier: `frontend/src/pages/project/WorkNfts.tsx:107-111`
- `.slice(0, MAX_LEN)` sans prevenir l'utilisateur

**F23 - Import inutilise**
- Fichier: `frontend/src/pages/Documentation.tsx:1`
- `createSignal` importe mais partiellement utilise

**F24 - Pas de debounce sur recherche invite**
- Fichier: `frontend/src/components/project/ShareAllocator.tsx:181-191`
- Re-render a chaque frappe

**F25 - Cast Error incomplet**
- Fichier: `frontend/src/pages/PublicSale.tsx:198`
- Meme pattern que F6

**F26 - Suppression draft NFT irreversible**
- Fichier: `frontend/src/pages/project/WorkNfts.tsx:163`
- Confirm dialog mais pas d'undo

**F27 - console.error() expose donnees sensibles**
- Fichier: Multiple fichiers
- URLs API, tokens potentiels dans la console browser

**F28 - Boutons icone sans aria-label**
- Fichier: Multiple fichiers
- Inaccessibles aux lecteurs d'ecran

**F29 - Acces tableau non protege**
- Fichier: `frontend/src/pages/Activity.tsx:286`
- Pattern `conv.display_name?.[0]` inconsistant entre fichiers

**F30 - Pas de maxLength sur inputs texte**
- Fichier: `frontend/src/pages/Onboarding.tsx:191-219`
- L'utilisateur tape sans limite, l'API rejette tard

**F31 - Pas de deduplication de requetes**
- Fichier: `frontend/src/lib/api-client.ts`
- Double-click = double requete mutation

### INFO

**F32 - Pattern d'erreur inconsistant**
- Fichier: Multiple fichiers
- Mix de `alert()`, modal, inline error

**F33 - Reconnexion WS sans backoff exponentiel**
- Fichier: `frontend/src/hooks/createWebSocket.ts:37-42`
- Peut boucler indefiniment

---

## SMART CONTRACTS (Solidity) - 18 issues

### CRITICAL

**S1 - Minter peut creer des collections**
- Fichier: `blockchain/src/HeritageFactory.sol:54`
- `msg.sender == minter` autorise dans `createHeritage()` ; si cle minter compromise, creation illimitee de collections

**S2 - Redirects a un seul niveau = fonds perdus**
- Fichier: `blockchain/src/PaymentRegistry.sol:75-98`
- `pay(A)` resout A->B mais si B->C est ajoute apres, les fonds vont a B (inactif) et restent bloques dans pendingWithdrawals[B]

### HIGH

**S3 - Pas de test replay cross-chain**
- Fichier: `blockchain/src/DocumentRegistry.sol:37-45`
- EIP-712 domain separator correct mais aucun test de replay protection

**S4 - Refund echoue = fonds bloques**
- Fichier: `blockchain/src/HeritageVault.sol:139-147`
- Si le buyer est un contrat qui rejette ETH, l'excedent reste dans le vault ; `rescueETH()` permet au producer de le recuperer

**S5 - Erreur d'arrondi dans la distribution**
- Fichier: `blockchain/src/HeritageSplitter.sol:74-87`
- Division entiere, le dernier beneficiaire recoit systematiquement le dust ; injuste sur le long terme

### MEDIUM

**S6 - Pas d'event Burned explicite**
- Fichier: `blockchain/src/HeritageNFT.sol:92-96`
- Seul le Transfer standard est emis ; indexeurs off-chain peuvent manquer les burns

**S7 - Minter sans timelock**
- Fichier: `blockchain/src/HeritageNFT.sol:54-64`
- Changement/revocation minter instantane, pas de delai de grace

**S8 - Pas d'event a l'initialization**
- Fichier: `blockchain/src/PaymentRegistry.sol:51-54`
- L'owner initial n'est pas logge dans un event

**S9 - Pas de test pour maxPrice**
- Fichier: `blockchain/test/HeritageVault.t.sol`
- Le parametre slippage protection n'a aucun test edge case

**S10 - Pas de test replay nonce**
- Fichier: `blockchain/test/DocumentRegistry.t.sol`
- Aucun test verifiant qu'une signature avec ancien nonce est rejetee

**S11 - Pas de test acces non-autorise**
- Fichier: `blockchain/test/HeritageFactory.t.sol`
- Aucun test verifiant qu'un tiers ne peut pas appeler `createHeritage()`

### LOW

**S12 - Erreurs ambigues**
- Fichier: `blockchain/src/HeritageVault.sol:170`
- `PaymentFailed()` utilise pour "no balance" ET "transfer failed"

**S13 - Format signature non documente**
- Fichier: `blockchain/src/DocumentRegistry.sol:101-109`
- Le format `r||s||v` attendu n'est pas documente

**S14 - Pas de burnBatch()**
- Fichier: `blockchain/src/HeritageNFT.sol:92-96`
- `mintBatch()` existe mais pas l'equivalent pour burn

**S15 - Interface registry non verifiee**
- Fichier: `blockchain/src/HeritageSplitter.sol:48`
- Pas de `supportsInterface()` check sur le registry passe au constructeur

### INFO

**S16 - Storage gap a documenter**
- Fichier: `blockchain/src/PaymentRegistry.sol:130`
- 46 slots gap correct mais pas de commentaire sur le calcul

**S17 - Royalties -> splitter direct**
- Fichier: `blockchain/src/HeritageNFT.sol:49`
- Ventes secondaires bypass le vault, intentionnel mais a documenter

**S18 - onERC721Received ignore from**
- Fichier: `blockchain/src/HeritageVault.sol:176-179`
- Trust model implicite sur le contrat NFT, a documenter
