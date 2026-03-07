# Heritage Splitter — Mapping juridique

## Articles du Code de la Propriété Intellectuelle (CPI)

### Droit de suite (Art. L122-8 CPI)
- Les auteurs d'oeuvres graphiques et plastiques bénéficient d'un droit inaliénable
  de participation au produit de toute vente d'une oeuvre après la première cession.
- **Implémentation** : Le HeritageSplitter applique automatiquement le droit de suite
  en phase SECONDARY via les shares configurées.

### Droit de reproduction (Art. L122-3 CPI)
- La reproduction consiste dans la fixation matérielle de l'oeuvre.
- **Implémentation** : Le NFT constitue une reproduction numérique dont les droits
  sont gérés par le smart contract.

### Obligations fiscales du producteur
- **TVA réduite 5.5%** (Art. 278-0 bis CGI) : applicable aux cessions de droits d'auteur.
- **URSSAF ~17%** : cotisations sociales du producteur.
- **Amortissements** : le producteur doit pouvoir amortir ses investissements.
- **Implémentation** : Phase PRIMARY → 100% au producteur pour conformité fiscale.

### Transparence (Art. L132-28 CPI)
- L'auteur a droit à une reddition des comptes transparente.
- **Implémentation** : Toutes les transactions sont on-chain, vérifiables via la page
  de vérification publique et le QR code phygital.

## Avantages du modèle hybride

1. **Conformité producteur** : Phase primaire respecte les obligations TVA/URSSAF
2. **Protection artiste** : Phase secondaire = split automatique trustless
3. **Traçabilité** : Blockchain publique = preuve irréfutable
4. **Flexibilité** : Parts configurables, pas de valeurs fixes imposées
