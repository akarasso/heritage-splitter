# Plan : Optimisation du deploiement Factory via Clones

**Date** : 2026-03-06
**Statut** : A faire (post-hackathon)
**Auteur** : Claude / Alexandre

---

## 1. Etat des lieux

### Comment ca marche aujourd'hui

La `HeritageFactory.createHeritage()` deploie 3 contrats a chaque appel :

```solidity
HeritageSplitter splitter = new HeritageSplitter(...);  // ~500k gas
HeritageNFT nft = new HeritageNFT(...);                 // ~1.8M gas
HeritageVault vault = new HeritageVault(...);            // ~800k gas
```

**Cout total mesure : ~3.09M gas par creation d'oeuvre.**

C'est le mecanisme `CREATE` classique : a chaque appel, le bytecode complet de
chaque contrat est redeploye. Pour 3 contrats heritant d'OpenZeppelin (ERC721,
ERC721Enumerable, ERC721Royalty, ReentrancyGuard...), ca fait beaucoup de
bytecode duplique a chaque oeuvre creee.

### Pourquoi c'est un probleme

- **Cout** : sur Avalanche C-Chain a 25 nAVAX/gas, 3.09M gas = ~0.077 AVAX par
  oeuvre. Avec 1000 oeuvres, ca fait 77 AVAX juste en deploiement.
- **Limite de block** : 3.09M gas represente une part significative du gas limit
  par block. Si le reseau est congestionne, le deploy peut echouer.
- **Scalabilite** : chaque oeuvre redeploie ~30KB de bytecode identique.

---

## 2. Option A : Clones ERC-1167 (Minimal Proxy)

### Principe

Deployer chaque implementation (Splitter, NFT, Vault) **une seule fois**.
Ensuite, `createHeritage()` deploie des **minimal proxies** de 45 bytes
qui redirigent tous les appels vers l'implementation via `delegatecall`.

OpenZeppelin fournit `Clones.clone(implementation)` pour ca.

### Changements requis

1. **Rendre les contrats initialisables** (remplacer `constructor` par `initialize`) :
   - `HeritageSplitter` : constructeur actuel → `initialize(producer, wallets, roles, shares, royaltyBps, registry)`
   - `HeritageNFT` : constructeur actuel → `initialize(name, symbol, splitter, royaltyBps, owner, contractURI, minter)`
   - `HeritageVault` : constructeur actuel → `initialize(nftContract, splitter, producer, minter)`
   - Ajouter `Initializable` (OpenZeppelin) a chaque contrat + `_disableInitializers()` dans le constructeur

2. **Modifier la Factory** :
   ```solidity
   import "@openzeppelin/contracts/proxy/Clones.sol";

   address public immutable splitterImpl;
   address public immutable nftImpl;
   address public immutable vaultImpl;

   constructor(address _splitterImpl, address _nftImpl, address _vaultImpl) {
       splitterImpl = _splitterImpl;
       nftImpl = _nftImpl;
       vaultImpl = _vaultImpl;
   }

   function createHeritage(...) external returns (...) {
       address splitter = Clones.clone(splitterImpl);
       HeritageSplitter(splitter).initialize(...);

       address nft = Clones.clone(nftImpl);
       HeritageNFT(nft).initialize(...);

       address vault = Clones.clone(vaultImpl);
       HeritageVault(vault).initialize(...);
       // ...
   }
   ```

3. **Modifier le Deploy.s.sol** : deployer les 3 implementations + la Factory qui les reference.

### Estimation de gas

- Clone deploy : ~45k gas par contrat (vs 500k-1.8M actuellement)
- Initialize : ~50-100k gas par contrat (ecriture du storage)
- **Total estime : ~300-500k gas par creation** (vs 3.09M = **reduction de ~85%**)

### Avantages

- **Reduction massive du gas** : ~6-10x moins cher par oeuvre
- **Pas de changement d'interface** : les contrats clones exposent exactement la
  meme ABI que les implementations. Le backend, le frontend, les Splitters
  existants ne changent rien.
- **Simple a implementer** : OpenZeppelin `Clones.sol` est battle-tested
- **Pas d'overhead a l'execution** : le `delegatecall` du proxy coute ~2600 gas
  par appel (negligeable sur des operations comme `purchase()` ou `pay()`)

### Inconvenients

- **Refacto des constructeurs** : les 3 contrats doivent devenir initialisables.
  C'est le gros du travail — il faut s'assurer que `initialize` ne peut etre
  appele qu'une fois, et que les `immutable` (comme dans Splitter) deviennent
  des variables de storage.
- **Perte des `immutable`** : les variables `immutable` du Splitter (producer,
  royaltyBps, registry) deviennent du storage normal. Cout de lecture legerement
  plus eleve (~2100 gas SLOAD vs ~3 gas pour un immutable). Impact negligeable
  sur nos operations.
- **Dependance a l'implementation** : si l'implementation est detruite
  (`selfdestruct`), tous les clones deviennent inutilisables. Mais
  `selfdestruct` est deprecie depuis Dencun, donc risque quasi nul.
- **Pas d'upgrade individuel** : tous les clones partagent la meme implementation.
  On ne peut pas upgrader un seul Splitter. (Ce n'est pas un probleme pour nous
  — on ne veut pas upgrader les Splitters individuellement.)

---

## 3. Option B : CREATE2 + Clones (Deterministic Clones)

### Principe

Meme chose que l'option A, mais en utilisant `Clones.cloneDeterministic(impl, salt)`
au lieu de `Clones.clone(impl)`. L'adresse du clone est calculable a l'avance
via `Clones.predictDeterministicAddress(impl, salt, factory)`.

### Changements supplementaires par rapport a l'option A

1. **Generer un salt** par oeuvre (ex: `keccak256(abi.encode(producer, name, block.number))`)
2. **Ajouter une fonction de prediction** :
   ```solidity
   function predictAddresses(bytes32 salt) external view
       returns (address nft, address splitter, address vault)
   {
       nft = Clones.predictDeterministicAddress(nftImpl, salt);
       splitter = Clones.predictDeterministicAddress(splitterImpl, salt);
       vault = Clones.predictDeterministicAddress(vaultImpl, salt);
   }
   ```

### Estimation de gas

- Identique a l'option A (~300-500k gas). CREATE2 coute quelques gas de plus
  que CREATE mais la difference est negligeable (<100 gas).

### Avantages (en plus de ceux de l'option A)

- **Adresses predictibles** : le frontend peut afficher les adresses des contrats
  *avant* la transaction de deploiement. Utile pour le UX ("votre collection
  sera deployee a 0x...").
- **Multi-chain** : si on deploie la Factory a la meme adresse sur plusieurs
  chaines (via CREATE2 aussi pour la Factory), alors meme salt = memes adresses
  de clones sur toutes les chaines. Pratique pour un futur cross-chain.
- **Idempotence** : si le deploy echoue partiellement (hors de la Factory — par
  ex. un script multi-tx), on peut recalculer les adresses attendues et verifier
  l'etat.

### Inconvenients (en plus de ceux de l'option A)

- **Complexite du salt** : il faut choisir un schema de salt qui evite les
  collisions tout en restant deterministe. Si deux oeuvres ont le meme salt,
  la deuxieme echoue.
- **Pas de redeploy au meme salt** : une fois un clone deploye avec un salt
  donne, cette combinaison est brulee. Si on `selfdestruct` le clone (deprecie)
  et qu'on redeploy avec le meme salt, le bytecode doit etre identique.
- **Benefice multi-chain premature** : on n'est que sur Avalanche pour l'instant.
  Le multi-chain ajouterait de la complexite (bridge, sync d'etat) bien au-dela
  du choix CREATE vs CREATE2.

---

## 4. Decision Record

### Recommandation : Option A (Clones ERC-1167 simples)

**Raison** : le gain de gas (~85%) est le meme entre les deux options.
L'option B ajoute de la complexite (gestion du salt, prediction d'adresses)
pour des benefices (multi-chain, adresses predictibles) dont on n'a pas
besoin aujourd'hui.

Le principe YAGNI s'applique : si un jour on a besoin de multi-chain ou
d'adresses deterministes, migrer de `Clones.clone()` vers
`Clones.cloneDeterministic()` est un changement d'une ligne par contrat.

### Plan d'execution (post-hackathon)

1. Rendre `HeritageSplitter` initialisable (remplacer immutables par storage + `initialize()`)
2. Rendre `HeritageNFT` initialisable
3. Rendre `HeritageVault` initialisable
4. Modifier `HeritageFactory` pour utiliser `Clones.clone()` + appel a `initialize()`
5. Mettre a jour `Deploy.s.sol` pour deployer les 3 implementations + la Factory
6. Mettre a jour les tests
7. Verifier que le backend n'a pas besoin de changements (normalement non — meme ABI)
8. Deployer et verifier sur Fuji
9. Si OK, deployer en mainnet

### Impact estime

| Metrique                | Avant (CREATE) | Apres (Clones) |
|-------------------------|----------------|----------------|
| Gas par oeuvre           | ~3.09M         | ~300-500k      |
| Cout par oeuvre (25 nAVAX/gas) | ~0.077 AVAX | ~0.008-0.013 AVAX |
| Cout pour 1000 oeuvres  | ~77 AVAX       | ~8-13 AVAX     |
| Deploy initial (une fois)| ~3.9M (Factory)| ~3.9M (Factory) + ~5M (3 impls) |
