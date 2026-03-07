# Heritage Splitter - Audit Round 3

**Date**: 2026-03-07
**Auditeur**: Claude Opus 4.6
**Scope**: Backend (Rust/Axum), Frontend (SolidJS/TS), Smart Contracts (Solidity)
**Contexte**: Troisieme audit apres correction de 115+36=151 issues sur les deux rounds precedents

---

## Resume Global

| Severite | Backend | Frontend | Contracts | Total |
|----------|---------|----------|-----------|-------|
| CRITICAL | 0 | 2 | 0 | 2 |
| HIGH | 2 | 3 | 0 | 5 |
| MEDIUM | 3 | 6 | 3 | 12 |
| LOW | 2 | 3 | 3 | 8 |
| **Total** | **7** | **14** | **6** | **27** |

---

## BACKEND (Rust/Axum) - 7 issues

### HIGH

**B3-1 - Max slots compte les participants kicked**
- Fichier: `backend/src/routes/participants.rs:82-94`
- Le check de max_slots utilise `status != 'rejected'` mais devrait aussi exclure `'kicked'`. Un participant kicked est encore compte, empechant de re-remplir le slot.

**B3-2 - Custom shares: participant insere avant validation**
- Fichier: `backend/src/routes/participants.rs:169-189`
- En mode custom, la validation que les shares totales ne depassent pas total_bps se fait APRES l'INSERT du participant. Si la validation echoue, un enregistrement orphelin reste en DB.

### MEDIUM

**B3-3 - Shares_bps sans borne superieure**
- Fichier: `backend/src/routes/participants.rs:482-487`
- `update_participant` valide `shares < 0` mais pas `shares > 10000`. Un participant pourrait avoir des shares > total allocation.

**B3-4 - Certification: fenetre d'inconsistance**
- Fichier: `backend/src/routes/documents.rs:343-379`
- Le claim atomique set `certified_by`/`certified_at` AVANT l'appel blockchain. Si la blockchain echoue, le rollback restaure, mais entre le claim et le rollback un read concurrent voit un document "certifie" sans tx_hash.

**B3-5 - Recompute shares inclut les participants invited**
- Fichier: `backend/src/routes/allocations.rs:380-417`
- `recompute_equal_shares` compte les participants avec `status NOT IN ('rejected', 'kicked')`, ce qui inclut les `invited` qui n'ont pas encore accepte. Les shares sont calculees pour des gens qui ne participeront peut-etre jamais.

### LOW

**B3-6 - Distribution mode vide accepte**
- Fichier: `backend/src/routes/allocations.rs:59-60, 236-238`
- La validation check `!= "equal" && != "custom"` mais une chaine vide `""` passerait ce test et serait rejetee — en fait c'est deja gere (vide != equal et != custom donc rejete). Faux positif a confirmer.

**B3-7 - max_slots sans borne superieure**
- Fichier: `backend/src/routes/allocations.rs:47-50`
- `max_slots > 0` est valide mais pas de borne max. Theoriquement i64::MAX est accepte. Impact negligeable.

---

## FRONTEND (SolidJS/TypeScript) - 14 issues

### CRITICAL

**F3-1 - Unhandled promise rejection dans ProjectNew auto-fill**
- Fichier: `frontend/src/pages/ProjectNew.tsx:72-84`
- Si `aiGenerateImage` throw avant le `.then()`, le `await imagePromise` ligne 92 peut relancer l'erreur non catchee. Le signal `generatingImage` pourrait rester a true indefiniment.

**F3-2 - sanitizeImageUrl ne bloque pas les SVG data URIs**
- Fichier: `frontend/src/lib/utils.ts:114-121`
- `sanitizeImageUrl` accepte tout `data:image/*` y compris `data:image/svg+xml` qui peut contenir du JavaScript. Un backend compromis pourrait envoyer un SVG malveillant.

### HIGH

**F3-3 - WebSocket listeners persistent apres remount**
- Fichier: `frontend/src/hooks/createWebSocket.ts:28-40`
- Les listeners sont dans un Set module-level. Si un composant remount (HMR, navigation), les anciens listeners restent et dupliquent le traitement des messages.

**F3-4 - Race condition polling dans ProjectDiscussion**
- Fichier: `frontend/src/pages/project/ProjectDiscussion.tsx:103-109`
- Le polling toutes les 5s peut recevoir une reponse pour un ancien thread si l'utilisateur change de thread entre deux polls. Le resultat du vieux poll ecrase les messages du nouveau thread.

**F3-5 - Invite form pas reset apres erreur**
- Fichier: `frontend/src/components/project/ShareAllocator.tsx:196-219`
- Si l'API d'invitation echoue, le formulaire garde l'ancienne selection. L'utilisateur ne peut pas retenter facilement.

### MEDIUM

**F3-6 - Timer invite search sans cleanup**
- Fichier: `frontend/src/components/project/ShareAllocator.tsx:181-188`
- Le `inviteSearchTimer` n'est pas clear dans `onCleanup()`. Si le composant unmount pendant le debounce, le timer fire sur un composant detruit.

**F3-7 - Null check manquant dans insertMention**
- Fichier: `frontend/src/pages/project/ProjectDiscussion.tsx:184-194`
- `newContentRef` et `inputRef` ne sont pas verifies null avant utilisation dans `insertMention()`.

**F3-8 - mentionMap module-level persiste entre threads**
- Fichier: `frontend/src/pages/project/ProjectDiscussion.tsx:25,71,194,459`
- Le `mentionMap` est un Map global, pas clear systematiquement quand on change de thread. Des mentions d'un ancien thread peuvent fuiter dans le nouveau.

**F3-9 - WorkLayout WebSocket listener pas cleanup au changement de params**
- Fichier: `frontend/src/pages/project/WorkLayout.tsx:32-47`
- Le listener WebSocket pour les events work verifie `params.workId` mais n'est pas re-enregistre quand `params.workId` change. L'ancien listener reste actif.

**F3-10 - Type assertion unsafe sur window.ethereum**
- Fichier: `frontend/src/pages/PublicSale.tsx:111-115`
- `(window as unknown as Record<string, unknown>).ethereum` bypass la type safety. Si MetaMask n'est pas installe ou mal initialise, les checks suivants ne catchent pas tous les cas.

**F3-11 - Token/URL leak possible dans console.warn**
- Fichier: `frontend/src/lib/api-client.ts:54-63`
- Les erreurs API loggees en console peuvent contenir des URLs avec tokens ou des donnees sensibles du backend.

### LOW

**F3-12 - generatingImage pas reset si aiGenerateImage throw**
- Fichier: `frontend/src/pages/ProjectNew.tsx:71,82`
- Si l'appel initial throw avant que la promise soit creee, `setGeneratingImage(false)` dans le `.finally()` n'est jamais atteint.

**F3-13 - Royalty input accepte potentiellement negatif**
- Fichier: `frontend/src/pages/project/WorkOverview.tsx:96-98`
- Le champ royalty `<input type="number">` n'a pas de `min="0"` explicite dans le HTML. La validation JS existe mais un edge case pourrait passer.

**F3-14 - Pas de validation wallet cote client**
- Fichier: `frontend/src/lib/api-client.ts:87-92`
- `getNonce()` et `verify()` envoient l'adresse wallet sans validation de format cote client. Le backend valide, mais le feedback serait meilleur cote client.

---

## SMART CONTRACTS (Solidity) - 6 issues

### MEDIUM

**S3-1 - rescueETH sans event**
- Fichier: `blockchain/src/HeritageVault.sol:191-197`
- `rescueETH()` transfere des fonds mais n'emet aucun event. Toutes les autres fonctions de transfert emettent des events. Trou dans l'auditabilite on-chain.

**S3-2 - Pas de tests pour rescueETH()**
- Fichier: `blockchain/test/HeritageVault.t.sol`
- La fonction `rescueETH(address)` n'a aucun test : ni le cas succes, ni le cas zero balance, ni le controle d'acces.

**S3-3 - listAvailableTokens() sans limite = DoS potentiel**
- Fichier: `blockchain/src/HeritageVault.sol:160-169`
- `listAvailableTokens()` itere sur TOUS les tokens du vault sans pagination. Si le vault accumule des milliers de NFTs, l'appel depasse la gas limit du bloc. Les batch ops (mint, burn, setPrice) sont limitees a 100, mais cette view function ne l'est pas.

### LOW

**S3-4 - Erreur inconsistante: require() vs custom error dans acceptOwnership**
- Fichier: `blockchain/src/DocumentRegistry.sol:93-94`
- `acceptOwnership()` utilise `require()` alors que tout le reste du contrat utilise des custom errors (`revert NotOwner()`).

**S3-5 - Erreur inconsistante: require() vs custom error dans rescueETH**
- Fichier: `blockchain/src/HeritageVault.sol:192`
- `require(to != address(0), "Zero address")` melange avec `revert NothingToRescue()` et `revert RescueFailed()` dans la meme fonction.

**S3-6 - Erreur inconsistante: require() dans HeritageFactory**
- Fichier: `blockchain/src/HeritageFactory.sol:52-55`
- Toutes les validations utilisent `require()` au lieu de custom errors, contrairement aux autres contrats du projet.
