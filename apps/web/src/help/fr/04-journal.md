# Journal

Le journal contient une écriture par opération, **passée ou future**, pour le livre ouvert.

## Une écriture

| Champ             | Remarques                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Date              | L'année et le mois en sont déduits                                                                                            |
| Compte            | Sa devise est celle de l'écriture                                                                                             |
| Sous-catégorie    | Donne la catégorie, le groupe et la nature                                                                                    |
| Description       | Texte libre                                                                                                                   |
| Montant           | **Signé**, comme sur le relevé : −12,50 pour un paiement                                                                      |
| Taux de change    | Affiché quand le compte n'est pas dans la devise du livre. Conservé à l'enregistrement, donc les totaux passés ne bougent pas |
| Montant d'origine | Facultatif, pour information : ce que vous avez réellement payé dans une autre devise                                         |
| Rapproché         | Pointé avec le relevé bancaire. Une écriture non rapprochée est une **prévision**                                             |

La catégorie décide si un montant est un revenu ou une dépense, jamais son signe.

## Mois du budget

Une écriture compte dans le mois de sa date. Quand elle tombe juste avant ou juste après le mois auquel elle appartient (un salaire versé le 31, un loyer prélevé le 2), cochez **Compter en …** : jusqu'au 15, elle compte dans le mois précédent ; à partir du 16, dans le mois suivant. Le journal l'indique à côté de sa date (« → nov. »).

- Les budgets, le tableau de bord et le choix de la période du journal suivent ce mois.
- Les soldes, la projection et le pointage suivent toujours la date.
- Quand l'import d'un relevé change le mois d'une prévision, la case est cochée toute seule pour qu'elle reste dans son mois.
- Si vous changez la date, la case reste cochée tant que le même mois peut être atteint.

## Saisir vite

- **Nouvelle écriture** ouvre le formulaire. **Partir d'une saisie fréquente** propose les écritures que vous avez saisies vous-même le plus souvent sur les 12 derniers mois (les planifiées sont écartées), datées d'aujourd'hui. Une nouvelle écriture est cochée **Rapproché** : décochez pour saisir une prévision.
- La flèche de **Nouvelle écriture** démarre aussi un **transfert** ou une **compensation**.
- **Dupliquer** copie une écriture existante.
- **Marquer rapprochées** et **Marquer en prévision** changent le statut d'une écriture depuis la liste.

## Compensations

Une **compensation** compte un montant dans deux sous-catégories sans que de l'argent bouge. Exemple, dans un livre commun : un membre paie 50 d'alimentation avec son compte personnel. **Nouvelle écriture ▾ › Nouvelle compensation**, 50, avec _Contribution_ en + et _Alimentation_ en −.

- Elle apparaît en deux lignes, marquées **±**, sans compte et sans rien à pointer.
- Ouvrez l'une des lignes pour modifier, dupliquer ou supprimer toute la compensation.
- Le montant est positif, dans la devise du livre. Pour un remboursement, inversez les deux sous-catégories.
- Les deux lignes comptent dans les totaux et le tableau de bord, et consomment le budget de leurs catégories. Aucun solde de compte ne bouge.
- Les sous-catégories d'une catégorie de transfert ne sont pas proposées.
- Rien n'est lié entre les livres : dans le sien, le membre saisit son écriture bancaire ordinaire.

## Retrouver

Filtrez par période (année, mois), compte, catégorie, sous-catégorie, statut et recherche texte. Les cartes de compte filtrent sur un compte. **Filtres** ouvre les choix de catégorie et de statut ; le statut **Compensations** ne montre que les compensations. L'en-tête affiche les revenus, dépenses et le net de ce qui est affiché. Une ligne marque **aujourd'hui** entre les écritures passées et futures.

## Prévisions et rapprochement

Saisissez ce que vous savez à venir (loyer, facture) en prévision. Quand la banque le montre, mettez le montant de la banque et cochez **Rapproché**. Les prévisions alimentent la projection de trésorerie.

## Lignes Budget

À la fin de chaque mois budgété dans la grille d'une catégorie, une ligne **Budget** calculée montre ce qui reste attendu, sur le compte du budget (voir [Budget](06-budget.md)). Elle ne se modifie pas ; la rapprocher abandonne le reste.

Un message au-dessus du journal signale les écritures passées non rapprochées, lignes Budget comprises.

## Graphique des comptes

En bas du journal, un graphique montre le solde de vos comptes jour après jour, passé et projeté. Seul le **filtre de compte** agit dessus. Changez son début et sa durée avec ses propres réglages, ou masquez-le.

**Les découverts sont bien visibles** : la partie sous zéro devient rouge, et un message donne, par compte, la période du découvert et son point le plus bas.
