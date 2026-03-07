# Marketplace intégré — HeritageNFT

## Pourquoi un marketplace intégré ?

Les NFT ERC-721 standard permettent des transferts directs (`transferFrom`, `safeTransferFrom`) qui contournent le paiement des royalties. Le standard ERC-2981 est purement informatif : les marketplaces tiers peuvent l'ignorer.

Pour garantir le respect du **droit de suite** (CPI L122-8), HeritageNFT bloque tous les transferts directs et force le passage par une fonction `buy()` intégrée au contrat.

## Mécanisme de restriction des transferts

La fonction `_update()` (hook interne d'OpenZeppelin ERC-721) est surchargée :

- **Mint** (`from == address(0)`) : autorisé
- **Achat via `buy()`** (`_buyInProgress == true`) : autorisé
- **Tout autre transfert** : revert avec `TransferNotAllowed()`

Cela bloque `transferFrom`, `safeTransferFrom`, et tout transfert via `approve` + `transferFrom`.

## Flow : listing → buy → paiement automatique

### 1. Mise en vente

```
seller → listForSale(tokenId, price)
```

Le propriétaire du NFT crée un listing avec un prix en wei. Il peut mettre à jour le prix en appelant `listForSale` à nouveau, ou annuler via `cancelListing`.

### 2. Achat

```
buyer → buy(tokenId) { value: price }
```

Le contrat effectue automatiquement :

#### Phase PRIMARY (première vente)
- 100% du prix → `splitter.receivePrimary(tokenId)`
- Le producteur peut ensuite libérer les fonds via `splitter.releasePrimary(tokenId)`

#### Phase SECONDARY (reventes)
- Royalty (ex: 10%) → `splitter.receiveSecondary(tokenId)` → distribution automatique aux bénéficiaires
- Reste (ex: 90%) → vendeur

### 3. Transfert

Le NFT est transféré à l'acheteur via `_transfer()` avec le flag `_buyInProgress` actif.

## Distinction primaire / secondaire

La phase de chaque token est gérée par `HeritageSplitter` :

| Phase | Déclencheur | Distribution |
|-------|-------------|-------------|
| PRIMARY | Première vente | 100% → producteur (via splitter) |
| SECONDARY | Après `releasePrimary()` | Royalty split entre bénéficiaires, reste au vendeur |

## Modèle de sécurité

### ReentrancyGuard
La fonction `buy()` utilise le modifier `nonReentrant` pour empêcher les attaques de réentrance.

### Checks-Effects-Interactions
1. **Checks** : vérification du listing, du montant, de l'acheteur
2. **Effects** : désactivation du listing (`listing.active = false`)
3. **Interactions** : paiements au splitter/vendeur, transfert du NFT

### Flag `_buyInProgress`
- Mis à `true` uniquement pendant l'exécution de `buy()`
- Vérifié par `_update()` pour autoriser le transfert
- Remis à `false` immédiatement après le transfert
- Protégé par `nonReentrant` contre toute exploitation

### Remboursement du surplus
Si l'acheteur envoie plus que le prix, le surplus est automatiquement remboursé.

## Conformité au droit français

- **Droit de suite (CPI L122-8)** : les royalties sont automatiquement prélevées et distribuées à chaque revente, sans possibilité de contournement
- **Traçabilité** : chaque vente émet un événement `Sale` avec vendeur, acheteur et prix
- **Distribution transparente** : les parts des bénéficiaires (artiste, producteur, galerie, droit_de_suite) sont définies à la création et appliquées automatiquement
