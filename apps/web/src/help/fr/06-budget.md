# Budget

La page **Budget** montre une année, catégorie par catégorie. Choisissez l'année avec les flèches, puis **Planifier** sur une catégorie. Une fois dedans, passez à une autre avec **Précédente**, **Suivante** ou la recherche par code ou nom.

## Deux façons de budgéter, qui s'ajoutent

- La **grille** : un montant par mois, sans dire quelles écritures le dépenseront.
- Les **écritures planifiées** : des écritures futures du journal, chacune avec un montant prévu.

Le budget d'un mois est la grille **plus** les montants prévus de ses écritures.

## La grille

Les montants se lisent dans le sens de la nature : une dépense est positive. Le budget et le réel de l'année précédente sont affichés au-dessus, pour vous aider.

- **Compte** : le compte d'où ce budget devrait être dépensé. Il est obligatoire et pilote la projection.
- **Taux de change** quand ce compte n'est pas dans la devise du livre.
- **Hypothèses** : texte libre sur ce sur quoi repose le plan.

La grille s'enregistre avec **Enregistrer**. Les écritures planifiées s'enregistrent une par une.

Depuis cette page, une écriture planifiée se modifie par son **montant prévu** : le changer remplace aussi le montant attendu. Le journal, lui, ne change que le montant attendu, et le rapprochement s'y fait.

## Remplir la grille

La grille se remplit comme un tableur.

- **Se déplacer** : Entrée et les flèches gauche et droite. Pendant la saisie, les flèches se déplacent dans le texte ; Échap annule la saisie.
- **Sélectionner** plusieurs mois : en glissant la souris, par Maj+clic ou Maj+flèches. La somme de la sélection est affichée.
- **Dans une case** : un montant, un calcul (`=450*3`), ou une modification (`+10`, `+3%`, `-5%`, `*2`, `/2`). `-250` est un montant négatif.
- **Sur la sélection**, avec le champ et **Appliquer** : les mêmes formes ; ici `-10` retire 10.
- **Recopier à droite** (Ctrl+R) : le premier mois sélectionné jusqu'à la fin de la sélection, ou jusqu'à décembre pour une seule case.
- **Copier le budget ou le réel de l'année précédente** : sur la sélection, ou sur toute la ligne quand une seule case est sélectionnée.
- **Répartir un total** : à parts égales, selon la forme actuelle, ou selon celle d'une ligne de l'année précédente. Sans total saisi, c'est le total actuel.
- **Copier-coller** avec un tableur : Ctrl+C copie la sélection, Ctrl+V colle à partir de la case active. Suppr vide une sélection.
- **Annuler et rétablir** (Ctrl+Z, Ctrl+Y) jusqu'à l'enregistrement.

Les mois rapprochés ne changent pas.

## La ligne Budget

Chaque mois dont la grille n'est pas à zéro a une ligne **Budget** à son dernier jour, dans le journal. Son montant est la grille moins les écritures **non prévues** du mois, jamais au-delà de zéro. Un remboursement l'augmente.

Les écritures planifiées ne consomment pas la grille : leur différence avec le prévu est leur **écart**.

**Rapprocher** la ligne abandonne le reste et verrouille la case du mois. Tant qu'elle n'est pas rapprochée, le reste est attendu, même pour un mois passé. Rien n'est reporté d'un mois à l'autre.

## Virements

Les catégories de virement n'ont pas de grille, seulement des virements planifiés.

## Variation des comptes

En bas, _revenus − dépenses − épargne_ montre ce que le plan fait à vos comptes. C'est donné pour information, pas comme un objectif.
