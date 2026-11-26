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

## Les écritures planifiées

La liste sous la grille se modifie en place. Elle s'enregistre avec la grille par **Enregistrer**, tout ou rien : tant que vous n'avez pas enregistré, le journal ne change pas.

- **Copier l'année précédente** reprend toutes les écritures de la catégorie de l'année d'avant, prévues ou non, un an plus tard, avec leur libellé, sous-catégorie, compte et type de paiement. Leur montant devient le montant prévu. Une écriture déjà là (même date, sous-catégorie et libellé) n'est pas recopiée. Les virements ne sont pas copiés.
- **Échéancier** crée une série d'écritures : première et dernière date, fréquence, sous-catégorie, libellé, compte, montant. La série n'est pas mémorisée : ce sont des écritures ordinaires.
- **Cochez** des lignes pour leur donner un nouveau montant ou un autre jour, changer leur compte ou leur sous-catégorie, les dupliquer ou les supprimer. Maj+clic coche une plage ; la case du titre coche toutes les lignes affichées par le **filtre**.
- Les flèches haut et bas et Entrée passent d'une ligne à l'autre.
- **Annuler** revient sur la dernière copie, création ou action sur les lignes cochées.

Une écriture rapprochée ne se modifie pas ici. Dans cette liste, le montant est le montant **prévu** : le changer remplace aussi le montant attendu.

## La ligne Budget

Chaque mois dont la grille n'est pas à zéro a une ligne **Budget** à son dernier jour, dans le journal. Son montant est la grille moins les écritures **non prévues** du mois, jamais au-delà de zéro. Un remboursement l'augmente.

Les écritures planifiées ne consomment pas la grille : leur différence avec le prévu est leur **écart**.

**Rapprocher** la ligne abandonne le reste et verrouille la case du mois. Tant qu'elle n'est pas rapprochée, le reste est attendu, même pour un mois passé. Rien n'est reporté d'un mois à l'autre.

## Virements

Les catégories de virement n'ont pas de grille, seulement des virements planifiés.

## Variation des comptes

En bas, _revenus − dépenses − épargne_ montre ce que le plan fait à vos comptes. C'est donné pour information, pas comme un objectif.
