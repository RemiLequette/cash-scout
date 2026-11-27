# Tableau de bord

Le **tableau de bord** lit une année d'un coup d'œil. Il ne modifie jamais les données, et tout membre le voit, lecteurs compris. Les montants sont dans la devise du livre.

## Le lire

- **Colonnes** : les 12 mois, le total de l'année et la valeur par mois (un douzième du total, prévisions comprises).
- **Lignes** : vos natures et soldes, dans l'ordre fixé dans les données de référence. Une nature s'ouvre sur ses groupes, catégories et sous-catégories. Utilisez _Tout déplier_ et _Tout replier_.
- La cellule d'une catégorie est la somme des écritures du mois (leur [mois du budget](04-journal.md)), rapprochées ou non, et de sa ligne Budget. Les valeurs futures sont affichées autrement que les passées. Le mois en cours est surligné.
- La ligne **Budget** apparaît sous une catégorie dépliée, pour que ses sous-catégories et cette ligne totalisent la catégorie.
- **Arrondir** masque les centimes.
- **Transferts**, au-dessus des soldes, donne ce que les transferts ont fait entrer (positif) ou sortir (négatif) des comptes, par date. Dépliez la ligne pour le détail par compte et sélectionnez une case pour voir ses écritures. La ligne d'ensemble n'est pas nulle quand un transfert est à cheval sur deux mois.
- **Soldes des comptes en fin de mois** additionne les écritures jusqu'à la fin de chaque mois. Les mois futurs sont le solde projeté. Les compensations, sans compte, ne changent aucun solde. Les soldes suivent les dates : avec des écritures comptées dans un autre mois, la variation d'un mois peut différer de la somme de ses cellules.

## Panneau de détail

Sélectionnez une cellule : le panneau du bas liste les **écritures** correspondantes, en lecture seule. Redimensionnez-le ou masquez-le, et ouvrez le journal depuis là.

## Évolution

La page **Évolution** reprend les lignes du tableau de bord avec une colonne par année, de la première à la dernière année qui a des écritures ou un budget.

- **Depuis** choisit la première année affichée et cache les précédentes. Le choix est conservé. Les soldes comptent toujours les années cachées.
- Chaque colonne est le total de l'année, prévisions et lignes Budget comprises. L'année en cours est surlignée, les années futures sont affichées autrement.
- **Par an / Par mois** : le total de l'année, ou son douzième. Les soldes ne changent pas.
- **Soldes des comptes en fin d'année** reprend le solde de décembre du tableau de bord.
- Le **graphique**, sous le tableau, montre pour chaque année une colonne par nature, empilée par groupe de premier niveau avec la couleur du groupe. Un groupe négatif est dessiné sous zéro. Survolez une colonne pour son détail. Les cases à gauche choisissent les natures montrées dans le graphique ; le tableau les garde toutes, et le choix est conservé.
