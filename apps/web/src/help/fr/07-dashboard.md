# Tableau de bord

Le **tableau de bord** lit une année d'un coup d'œil. Il ne modifie jamais les données, et tout membre le voit, lecteurs compris. Les montants sont dans la devise du livre.

## Le lire

- **Colonnes** : les 12 mois, le total de l'année et la valeur par mois (un douzième du total, prévisions comprises).
- **Lignes** : vos natures et soldes, dans l'ordre fixé dans les données de référence. Une nature s'ouvre sur ses groupes, catégories et sous-catégories. Utilisez _Tout déplier_ et _Tout replier_.
- La cellule d'une catégorie est la somme des écritures du mois (leur [mois du budget](04-journal.md)), rapprochées ou non, et de sa ligne Budget. Les valeurs futures sont affichées autrement que les passées. Le mois en cours est surligné.
- La ligne **Budget** apparaît sous une catégorie dépliée, pour que ses sous-catégories et cette ligne totalisent la catégorie.
- **Arrondir** masque les centimes.
- **Transferts**, au-dessus des soldes, donne ce que les transferts ont fait entrer (positif) ou sortir (négatif) des comptes, par date. Dépliez la ligne pour le détail par compte et sélectionnez une case pour voir ses écritures. La ligne d'ensemble n'est pas nulle quand de l'argent passe par un compte virtuel ou qu'un transfert est à cheval sur deux mois.
- **Soldes des comptes en fin de mois** additionne les écritures jusqu'à la fin de chaque mois. Les mois futurs sont le solde projeté. Les comptes virtuels sont exclus. Les soldes suivent les dates : avec des écritures comptées dans un autre mois, la variation d'un mois peut différer de la somme de ses cellules.

## Panneau de détail

Sélectionnez une cellule : le panneau du bas liste les **écritures** correspondantes, en lecture seule. Redimensionnez-le ou masquez-le, et ouvrez le journal depuis là.
