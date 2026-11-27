# Transferts

Un **transfert** déplace de l'argent entre deux comptes du même livre. Ce sont deux écritures, une **source** (négative) et une **destination** (positive), créées, modifiées et supprimées ensemble.

## Le créer

Utilisez **Nouveau transfert** dans le journal.

- La **date** est le jour où il quitte le compte source. Le **délai** (0 à 60 jours) fixe quand il arrive à destination.
- Entre comptes de **devises différentes**, saisissez les deux montants : le taux réel en découle.
- La **sous-catégorie** doit appartenir à une catégorie dont la nature est marquée _Transferts entre comptes_. Créez-en une dans les [données de référence](03-reference-data.md) d'abord.

## Le modifier

Le montant, les comptes, la sous-catégorie, la description et le type de paiement se modifient sur le transfert, jamais sur un seul côté : ouvrir un côté depuis le journal ouvre tout le transfert. Seul le **rapprochement** est propre à chaque côté, car chacun se pointe avec sa propre ligne de relevé.

Les transferts sont hors des totaux, car ils ne changent pas le solde du livre dans son ensemble.

Un transfert peut aussi faire partie du plan du budget (voir [Budget](06-budget.md)).
