# Données de référence

Les données de référence décrivent un livre. Un nouveau livre démarre **vide** : construisez-le au niveau de détail voulu. Un foyer peut découper l'alimentation en boulangerie, boucherie et supermarché, alors qu'un livre personnel garde une seule sous-catégorie.

## Catégories

Les catégories ont trois niveaux : **groupe → catégorie → sous-catégorie**. Les groupes peuvent s'imbriquer sans limite.

- Une **catégorie** a un **code** court (C01, P02…) qui fixe son ordre, et une **nature**.
- Une **sous-catégorie** est ce que vous choisissez sur une écriture. Elle donne la catégorie, le groupe et la nature.
- Les flèches réordonnent ; donnez une couleur à un groupe pour le tableau de bord. Un groupe sans couleur prend celle de son parent.
- Une sous-catégorie peut être **déplacée** vers une autre catégorie. Les écritures existantes suivent.
- **Archivez** ce que vous n'utilisez plus plutôt que de le supprimer. Les éléments archivés restent sur les anciennes écritures et reviennent avec _Afficher les archivés_.
- Un élément encore utilisé ne se supprime pas : le message dit par quoi et combien (sous-catégories, écritures, budgets…).

## Natures et soldes

Une **nature** dit quel genre de flux porte une catégorie : revenu, dépense, épargne, exceptionnel… Elle fixe la section de la catégorie dans le tableau de bord.

- **C'est la catégorie qui décide, pas le signe.** Un impôt prélevé est un revenu négatif ; un remboursement est une dépense positive. Les rapports additionnent les montants signés dans chaque catégorie.

### Le sens d'affichage

Chaque nature a un **affichage** :

- **Inversé**, pour les dépenses : les montants négatifs se lisent en positif.
- **Tel que saisi**, pour les revenus.

Il agit sur le tableau de bord, et sur le budget par un seul point : il dit ce que signifie un montant saisi dans la grille, qui ne porte pas de signe.

| 300 dans la grille        | Nature **inversée** (Dépenses) | Nature **telle que saisie** (Revenus) |
| ------------------------- | ------------------------------ | ------------------------------------- |
| Ce que cela veut dire     | 300 à dépenser                 | 300 à recevoir                        |
| Ligne Budget du journal   | -300                           | +300                                  |
| Solde prévu du compte     | baisse                         | monte                                 |
| Ce qui consomme la grille | les montants négatifs imprévus | les montants positifs imprévus        |

Les écritures et les soldes gardent toujours leur signe. Changer l'affichage d'une nature qui a déjà des budgets inverse donc le sens de leurs grilles.

### Virements et soldes

- Une nature peut être marquée **Virements entre comptes** : ses catégories servent aux virements et restent hors des totaux.
- Un **solde** est un sous-total : la somme, telle que saisie, des natures que vous choisissez.

Un nouveau livre démarre avec quatre natures : Revenus, Dépenses, Épargne et Virements.

## Comptes

- Les comptes **bancaires** sont rapprochés avec la banque et figurent dans la projection de trésorerie.
- Les comptes **virtuels** n'ont pas de banque derrière eux. Ils portent des compensations dont la somme est nulle, et sont hors de la projection.
- La **devise** d'un compte ne peut plus être changée une fois créé.
- Le **solde initial** est ce que le solde du compte contient sans que le journal l'explique : ce qui précède la première écriture, et ce qui manque. Il n'est dans aucune catégorie, donc dans aucun total ni budget. Menu du compte, **Solde initial…** : saisissez le solde lu dans votre banque, il est calculé pour que les écritures pointées donnent ce solde, quelle que soit leur date.
- L'**alerte de solde bas** est un montant : le graphique des comptes prévient quand le solde projeté passe en dessous.

## Types de paiement

Carte, virement, prélèvement, espèces, chèque, frais… Ajoutez ceux que vous utilisez.
