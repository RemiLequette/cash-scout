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

## Suivre en cours d'année

Sous la ligne **Budget** de l'année, deux lignes, par mois et en total :

- **Réalisé** : les écritures **rapprochées** de la catégorie. Les prévisions n'y comptent pas, même passées. La ligne **Réel** de l'année précédente, elle, compte toutes les écritures.
- **Restant** : le budget moins le réalisé, que le mois soit passé ou non, que sa ligne Budget soit rapprochée ou non. Il suit la grille et les écritures pendant que vous les saisissez.

Les deux se lisent dans le sens de la nature. Un restant négatif signale un dépassement pour une dépense, et une rentrée supérieure au budget pour un revenu.

Rien n'étant reporté automatiquement, pour reporter du non consommé, ajoutez-le vous-même aux mois à venir de la grille.

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

- Une ligne marquée **⑂** est une part d'une ventilation, dont les autres parts peuvent être dans d'autres catégories (survolez le repère). Son montant et sa sous-catégorie se modifient ici, mais son **jour**, son **compte**, sa **duplication** et sa **suppression** valent pour toute la ventilation.
- **Copier l'année précédente** reprend toutes les écritures de la catégorie de l'année d'avant, prévues ou non, un an plus tard, avec leur libellé, sous-catégorie et compte. Leur montant devient le montant prévu. Une écriture déjà là (même date, sous-catégorie et libellé) n'est pas recopiée. Une ventilation est copiée entière, une seule fois, quelle que soit la catégorie d'où vous la copiez. Les transferts ne sont pas copiés.
- **Échéancier** crée une série d'écritures : première et dernière date, fréquence, sous-catégorie, libellé, compte, montant. La série n'est pas mémorisée : ce sont des écritures ordinaires. **Ajouter une part** crée une série de [ventilations](04-journal.md) : une ligne par autre sous-catégorie, avec son montant prévu, et le **solde** qui prendra l'écart avec la banque.
- **Cochez** des lignes pour leur donner un nouveau montant ou un autre jour, changer leur compte ou leur sous-catégorie, les dupliquer ou les supprimer. Maj+clic coche une plage ; la case du titre coche toutes les lignes affichées par le **filtre**.
- Les flèches haut et bas et Entrée passent d'une ligne à l'autre.
- **Annuler** revient sur la dernière copie, création ou action sur les lignes cochées.

Une écriture rapprochée ne se modifie pas ici. Dans cette liste, le montant est le montant **prévu** : le changer remplace aussi le montant attendu.

## La ligne Budget

Chaque mois dont la grille n'est pas à zéro a une ligne **Budget** à son dernier jour, dans le journal. Son montant est la grille moins les écritures **non prévues** du mois, jamais au-delà de zéro. Un remboursement l'augmente.

Les écritures planifiées ne consomment pas la grille : leur différence avec le prévu est leur **écart**.

**Rapprocher** la ligne abandonne le reste et verrouille la case du mois. Tant qu'elle n'est pas rapprochée, le reste est attendu, même pour un mois passé. Rien n'est reporté d'un mois à l'autre.

## Transferts

Les catégories de transfert n'ont pas de grille, seulement des transferts planifiés. En bas de la page Budget, **Planifier** à côté de **Transferts planifiés** ouvre ceux de l'année.

La liste a **une ligne par transfert** et se modifie en place, comme les écritures planifiées : date de départ, délai, sous-catégorie, libellé, comptes source et destination, montant prévu. Un transfert est de l'année où il quitte le compte source. Le montant se saisit sans signe. Entre devises différentes, un second montant est le montant reçu ; un compte qui n'est pas dans la devise du livre demande son taux.

Rien ne change dans le journal avant **Enregistrer**, qui écrit tout ou rien.

- **Copier l'année précédente** reprend tous les transferts de l'année d'avant, prévus ou non, un an plus tard. Le montant devient le montant prévu. Un transfert déjà là (même date, sous-catégorie, libellé et comptes) n'est pas recopié, ni un transfert d'un compte ou d'une sous-catégorie archivés.
- **Échéancier** crée une série de transferts. La série n'est pas mémorisée : ce sont des transferts ordinaires.
- **Cochez** des lignes pour leur donner un nouveau montant ou un autre jour, changer leur compte source, leur compte destination ou leur sous-catégorie, les dupliquer ou les supprimer. Maj+clic coche une plage ; la case du titre coche toutes les lignes affichées par le **filtre**. Le nouveau montant ne touche pas les transferts entre devises différentes : saisissez leurs deux montants sur la ligne. Un changement de compte est ignoré sur une ligne dont les deux comptes deviendraient identiques, ou, pour un transfert déjà enregistré, dont la devise changerait.
- **Annuler** revient sur la dernière copie, création ou action sur les lignes cochées.

Un transfert dont un côté est rapproché ne se modifie pas ici. Changer le montant prévu remplace aussi le montant attendu des deux côtés.

## Variation des comptes

En bas, _revenus − dépenses − épargne_ montre ce que le plan fait à vos comptes. C'est donné pour information, pas comme un objectif.
