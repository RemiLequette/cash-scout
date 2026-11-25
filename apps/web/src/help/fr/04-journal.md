# Journal

Le journal contient une écriture par opération, **passée ou future**, pour le livre ouvert.

## Une écriture

| Champ             | Remarques                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Date              | L'année et le mois en sont déduits                                                                                            |
| Compte            | Sa devise est celle de l'écriture                                                                                             |
| Sous-catégorie    | Donne la catégorie, le groupe et la nature                                                                                    |
| Description       | Texte libre                                                                                                                   |
| Type de paiement  | Carte, virement, espèces…                                                                                                     |
| Montant           | **Signé**, comme sur le relevé : −12,50 pour un paiement                                                                      |
| Taux de change    | Affiché quand le compte n'est pas dans la devise du livre. Conservé à l'enregistrement, donc les totaux passés ne bougent pas |
| Montant d'origine | Facultatif, pour information : ce que vous avez réellement payé dans une autre devise                                         |
| Rapproché         | Pointé avec le relevé bancaire. Une écriture non rapprochée est une **prévision**                                             |

La catégorie décide si un montant est un revenu ou une dépense, jamais son signe.

## Saisir vite

- **Nouvelle écriture** ouvre le formulaire. **Partir d'une saisie fréquente** propose celles que vous utilisez le plus sur les 12 derniers mois, datées d'aujourd'hui.
- **Dupliquer** copie une écriture existante.
- **Marquer rapprochées** et **Marquer en prévision** changent le statut d'une écriture depuis la liste.

## Retrouver

Filtrez par période (année, mois), compte, catégorie, sous-catégorie, statut et recherche texte. L'en-tête affiche les revenus, dépenses et le net de ce qui est affiché. Une ligne marque **aujourd'hui** entre les écritures passées et futures.

## Prévisions et rapprochement

Saisissez ce que vous savez à venir (loyer, facture) en prévision. Quand la banque le montre, mettez le montant de la banque et cochez **Rapproché**. Les prévisions alimentent la projection de trésorerie.

## Lignes de budget non utilisé

À la fin de chaque mois, le budget non utilisé d'une catégorie **périodique** apparaît comme une ligne calculée, sur le compte de référence du budget. Elle ne se modifie pas. La rapprocher abandonne le budget non utilisé. Un message au-dessus du journal signale les mois passés dont la ligne n'est pas rapprochée.

## Graphique des comptes

En bas du journal, un graphique montre le solde de vos comptes jour après jour, passé et projeté. Seul le **filtre de compte** agit dessus. Changez son début et sa durée avec ses propres réglages, ou masquez-le.

**Les découverts sont bien visibles** : la partie sous zéro devient rouge, et un message donne, par compte, la période du découvert et son point le plus bas.
