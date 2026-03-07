# Heritage Splitter - Audit Round 2

**Date**: 2026-03-07
**Auditeur**: Claude Opus 4.6
**Scope**: Backend (Rust/Axum), Frontend (SolidJS/TS), Smart Contracts (Solidity)
**Contexte**: Second audit apres correction des 79 issues du premier audit + implementation de 5 features architecturales (F31, B23, F13, F5, B24)

---

## Resume Global

| Severite | Backend | Frontend | Contracts | Total |
|----------|---------|----------|-----------|-------|
| CRITICAL | 2 | 1 | 0 | 3 |
| HIGH | 3 | 6 | 0 | 9 |
| MEDIUM | 3 | 7 | 3 | 13 |
| LOW | 3 | 3 | 2 | 8 |
| INFO | 0 | 0 | 3 | 3 |
| **Total** | **11** | **17** | **8** | **36** |

---

## BACKEND (Rust/Axum) - 11 issues

### CRITICAL

**B2-1 - Cookie domain injection**
- Fichier: `backend/src/routes/auth.rs:182-191`
- La valeur `cookie_domain` du config est interpolee directement dans le header Set-Cookie sans validation. Un `COOKIE_DOMAIN` malveillant pourrait injecter des attributs cookie ou des headers supplementaires via des points-virgules ou retours a la ligne.

**B2-2 - Race condition certification document (TOCTOU)**
- Fichier: `backend/src/routes/documents.rs:318-323, 356-365`
- La ligne 318 met a jour le document avec les infos blockchain sans verifier s'il est deja certifie. Puis la ligne 356 fait un UPDATE atomique avec `WHERE tx_hash IS NULL`. Si deux certifications concurrentes arrivent, la premiere ecrit mais la seconde echoue atomiquement — cependant la premiere a deja ecrit avant le check atomique, creant une inconsistance.

### HIGH

**B2-3 - Allocation shares truncation silencieuse**
- Fichier: `backend/src/routes/works.rs:580-587`
- En mode equal, `alloc.total_bps / participants.len()` tronque silencieusement. Si total_bps=10001 et 3 participants : per_participant=3333, remainder=2, total distribue=9999 (2 bps perdus). La division entiere perd des bps qui n'atteignent pas le smart contract.

**B2-4 - Cursor pagination DM non valide**
- Fichier: `backend/src/routes/direct_messages.rs:114-132`
- Le parametre `before` (timestamp cursor) est utilise directement dans le SQL sans validation de format. Un attaquant pourrait envoyer `9999-12-31` pour sauter des messages. Le timestamp devrait etre valide comme NaiveDateTime avant utilisation.

**B2-5 - Distribution mode non valide**
- Fichier: `backend/src/routes/allocations.rs:230`
- `distribution_mode` est mis a jour sans valider que c'est `equal` ou `custom`. Des valeurs inconnues seraient stockees en DB et causeraient des erreurs au deploy.

### MEDIUM

**B2-6 - Reset approvals trop large**
- Fichier: `backend/src/routes/allocations.rs:154-162`
- Quand une allocation d'un work en `pending_approval` est modifiee, le code reset les `approved_at` de TOUS les participants du work, pas seulement ceux de cette allocation. Les participants d'autres allocations perdent leur approbation inutilement.

**B2-7 - Shares custom non validees a l'ajout participant**
- Fichier: `backend/src/routes/participants.rs:165-167`
- Apres ajout d'un participant en mode `custom`, `recompute_allocation_shares` ne fait rien (mode != equal). Les shares du nouveau participant ne sont pas validees contre le `total_bps` de l'allocation.

**B2-8 - Partage document avec liste vide accepte**
- Fichier: `backend/src/routes/documents.rs:396-398`
- `body.user_ids` peut etre une liste vide — le partage avec 0 utilisateurs est accepte silencieusement, generant une requete DB inutile.

### LOW

**B2-9 - work_id dans threads sans validation longueur**
- Fichier: `backend/src/routes/messages.rs:112`
- `body.work_id` est accepte sans check de longueur (devrait etre un UUID, 36 chars max).

**B2-10 - Notifications dupliquees possibles**
- Fichier: `backend/src/routes/participants.rs:188-211`
- Si un createur invite la meme personne deux fois rapidement, deux paires de notifications sont creees sans deduplication.

**B2-11 - Nonces non nettoyees en background**
- Fichier: `backend/src/routes/auth.rs:91-93`
- Le nettoyage des nonces expire se fait uniquement lors des appels verify. Si personne n'appelle verify pendant longtemps, les vieilles nonces s'accumulent. Mineur car le TTL de 15min previent les abus.

---

## FRONTEND (SolidJS/TypeScript) - 17 issues

### CRITICAL

**F2-1 - Acces tableau sans bounds check dans pagination**
- Fichier: `frontend/src/pages/Activity.tsx:114`
- `messages()[0]` est accede sans verifier que le tableau n'est pas vide. Le check `if (!oldest) return` ligne 115 vient trop tard si `messages()` est undefined.

### HIGH

**F2-2 - Race condition pagination messages**
- Fichier: `frontend/src/pages/Activity.tsx:64-124`
- Plusieurs appels `loadMessages()` peuvent etre declenches avant que les precedents ne se terminent. Le flag `loadingMore()` passe a true mais le scroll event peut encore trigger. Les messages pourraient etre inseres dans le mauvais ordre.

**F2-3 - Stale closure WebSocket dans Activity**
- Fichier: `frontend/src/pages/Activity.tsx:98-109`
- Le callback `useWebSocket` capture `selectedUser()` au moment du premier appel, pas de maniere reactive. Si l'utilisateur change de conversation, l'ancien handler traite encore les messages de l'ancien user.

**F2-4 - Mint en boucle sans gestion d'erreur individuelle**
- Fichier: `frontend/src/pages/project/WorkLayout.tsx:159-189`
- `handleMintAll()` appelle `api.mintWorkNft()` en boucle. Si un mint echoue, la boucle continue. Aucun etat d'erreur n'est preserve pour indiquer quels NFTs ont echoue.

**F2-5 - Cookie auth sans protection CSRF**
- Fichier: `frontend/src/hooks/createAuth.ts:18-42`
- Avec `credentials: "include"`, les cookies sont envoyes automatiquement. Mais aucun token CSRF n'est valide sur les requetes mutantes (POST/PUT/DELETE). Le header `X-Requested-With` existant offre une protection partielle mais pas complete.

**F2-6 - readContract non protege dans PublicSale**
- Fichier: `frontend/src/pages/PublicSale.tsx:169-175`
- `publicClient.readContract()` pour le prix du token peut echouer (erreur RPC) mais n'est pas dans un try/catch dedie. L'echec laisse `purchasingTokenId` set, bloquant l'UI.

**F2-7 - WebSocket listeners accumules (memory leak)**
- Fichier: `frontend/src/hooks/createWebSocket.ts:85-91`
- Les handlers sont ajoutes a un Set global mais si `createEffect` ne se cleanup pas correctement (notamment en HMR), les listeners s'accumulent, causant des doublons de traitement.

### MEDIUM

**F2-8 - Dedup key ne matche pas si body contient timestamps**
- Fichier: `frontend/src/lib/api-client.ts:63-81`
- La cle de deduplication inclut le body. Si deux requetes identiques ont des timestamps differents dans le body, la dedup ne fonctionne pas et les doublons passent.

**F2-9 - Pas de timeout sur resize image**
- Fichier: `frontend/src/lib/utils.ts:115-138`
- `resizeImage()` cree un Image + FileReader sans timeout. Un fichier corrompu ou enorme bloque l'UI indefiniment.

**F2-10 - URLs d'images non validees**
- Fichier: `frontend/src/pages/ProfileEdit.tsx` et autres
- Les images venant de l'API (avatars, logos) sont directement mises en `src` sans validation. Un backend compromis pourrait servir des data URLs malveillants.

**F2-11 - Non-null assertions fragiles dans PublicSale**
- Fichier: `frontend/src/pages/PublicSale.tsx:256`
- `collection()!.name` utilise une non-null assertion. Bien que protege par un `Show when={collection()}`, c'est fragile si la logique du guard change.

**F2-12 - refetchConvos erreur swallowed**
- Fichier: `frontend/src/pages/Activity.tsx:141-145`
- Dans `handleSendMessage`, `refetchConvos()` est dans un try/catch mais l'erreur est avalee silencieusement. L'utilisateur voit un succes meme si la liste des conversations ne se met pas a jour.

**F2-13 - safeParseAttrs cache les erreurs de parsing**
- Fichier: `frontend/src/pages/project/WorkNfts.tsx:15-23`
- `safeParseAttrs()` catch toutes les exceptions et retourne `[]`, cachant silencieusement les erreurs de parsing JSON. Les attributs corrompus disparaissent sans avertissement.

**F2-14 - Adresses contrat non validees dans WorkIntegration**
- Fichier: `frontend/src/pages/project/WorkIntegration.tsx:90-92`
- Les adresses de contrat sont inserees dans des URLs et affichees sans sanitisation. Devrait valider le format hex.

### LOW

**F2-15 - Pas de loading state pour generation image**
- Fichier: `frontend/src/pages/ProjectNew.tsx:70-88`
- La generation d'image IA demarre en parallele avec le typewriter. Si elle echoue, un avatar deterministe est genere sans feedback utilisateur.

**F2-16 - Aria-label manquants sur certains boutons**
- Fichier: Multiple fichiers
- Certains boutons avec uniquement des icones ou emojis n'ont toujours pas d'`aria-label`.

**F2-17 - Hash avatar inefficace pour noms longs**
- Fichier: `frontend/src/lib/utils.ts:73-77`
- Le calcul de hash boucle sur chaque caractere du nom. Pour des noms de 100 chars c'est negligeable mais pourrait utiliser une vraie fonction de hash.

---

## SMART CONTRACTS (Solidity) - 8 issues

### MEDIUM

**S2-1 - burnBatch sans limite de taille**
- Fichier: `blockchain/src/HeritageNFT.sol:111-117`
- `burnBatch()` n'a pas de limite sur la taille du tableau `tokenIds`. Un tableau trop grand depasse la gas limit du bloc (~21.4k gas/token, 1000 tokens = ~21.4M gas). La transaction echoue en gaspillant le gas de l'appelant.

**S2-2 - setPriceBatch sans limite de taille**
- Fichier: `blockchain/src/HeritageVault.sol:116-124`
- Meme probleme que S2-1 pour `setPriceBatch()`. ~25k gas/token. Risque plus faible car controle par le producer uniquement.

**S2-3 - rescueETH echoue si producer est un contrat**
- Fichier: `blockchain/src/HeritageVault.sol:189-194`
- Si le `producer` est un smart contract sans `receive()` ou `fallback()`, `rescueETH()` revert et les fonds restent bloques. La fonction de secours peut elle-meme echouer, ce qui est paradoxal. Solution : accepter une adresse de retrait en parametre.

### LOW

**S2-4 - Pas de tests pour claimRefund()**
- Fichier: `blockchain/test/HeritageVault.t.sol`
- La nouvelle fonction `claimRefund()` n'a aucun test. Tests manquants : succes, rien a rembourser, accumulation, emission d'event.

**S2-5 - Pas de tests pour burnBatch()**
- Fichier: `blockchain/test/HeritageNFT.t.sol`
- La nouvelle fonction `burnBatch()` n'a aucun test. Tests manquants : burn multiple, echec si pas owner de tous, verification enumeration apres burn.

### INFO

**S2-6 - Limite de 5 hops dans les redirects non documentee**
- Fichier: `blockchain/src/PaymentRegistry.sol:103-121`
- La boucle `pay()` resout les redirects avec max 5 hops. C'est correct mais la limite devrait etre documentee dans un commentaire NatSpec.

**S2-7 - Beneficiaire avec 0 shares accepte**
- Fichier: `blockchain/src/HeritageSplitter.sol`
- Le constructeur valide que le total = 10000 mais pas que chaque share individuelle > 0. Un beneficiaire avec 0% ne recoit jamais de fonds — pas de vulnerabilite mais gaspillage de gas.

**S2-8 - Verification duplicats O(n2)**
- Fichier: `blockchain/src/HeritageSplitter.sol:59-62`
- La detection de doublons utilise une boucle imbriquee O(n2). Pour N=3-10 beneficiaires c'est negligeable (~80k gas pour 10). Acceptable pour le cas d'usage.
