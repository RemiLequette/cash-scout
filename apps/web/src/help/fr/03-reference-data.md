# Données de référence

Les données de référence décrivent un livre. Un nouveau livre démarre **vide** : construisez-le au niveau de détail voulu. Un foyer peut découper l'alimentation en boulangerie, boucherie et supermarché, alors qu'un livre personnel garde une seule sous-catégorie.

## Catégories

Les catégories ont trois niveaux : **groupe → catégorie → sous-catégorie**. Les groupes peuvent s'imbriquer sans limite.

- Une **catégorie** a un **code** court (C01, P02…) qui fixe son ordre, et une **nature**.
- Une **sous-catégorie** est ce que vous choisissez sur une écriture. Elle donne la catégorie, le groupe et la nature.
- Les flèches réordonnent ; donnez une couleur à un groupe pour le tableau de bord. Un groupe sans couleur prend celle de son parent.
- Une sous-catégorie peut être **déplacée** vers une autre catégorie. Les écritures existantes suivent.
- **Archivez** ce que vous n'utilisez plus plutôt que de le supprimer. Les éléments archivés restent sur les anciennes écritures et reviennent avec _Afficher les archivés_.

## Natures et soldes

Une **nature** dit quel genre de flux porte une catégorie : revenu, dépense, épargne, exceptionnel… Elle fixe les sections du tableau de bord et la façon dont les budgets comptent la catégorie.

- **C'est la catégorie qui décide, pas le signe.** Un impôt prélevé est un revenu négatif ; un remboursement est une dépense positive. Les rapports additionnent les montants signés dans chaque catégorie et les lisent avec le signe de sa nature.
- L'affichage **Inversé** fait lire en positif les montants saisis en négatif (dépenses), dans le tableau de bord et les budgets.
- Une nature peut être marquée **Virements entre comptes** : ses catégories servent aux virements et restent hors des totaux.
- Un **solde** est un sous-total : la somme, telle que saisie, des natures que vous choisissez.

Un nouveau livre démarre avec quatre natures : Revenus, Dépenses, Épargne et Virements.

## Comptes

- Les comptes **bancaires** sont rapprochés avec la banque et figurent dans la projection de trésorerie.
- Les comptes **virtuels** n'ont pas de banque derrière eux. Ils portent des compensations dont la somme est nulle, et sont hors de la projection.
- La **devise** d'un compte ne peut plus être changée une fois créé.
- L'**alerte de solde bas** est un montant : le graphique des comptes prévient quand le solde projeté passe en dessous.

## Types de paiement

Carte, virement, prélèvement, espèces, chèque, frais… Ajoutez ceux que vous utilisez.
