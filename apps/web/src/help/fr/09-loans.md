# Emprunts

**Emprunts** dans le menu liste les emprunts du livre. Un emprunt garde ses conditions et ses évènements ; son **échéancier** en est calculé, jamais saisi. À partir de lui, l'emprunt prévoit ses échéances dans le journal, que le budget et la projection de trésorerie voient alors.

## Conditions

- **Commentaire** : texte libre pour le numéro de contrat, le contact, ce qui a été convenu. Il est affiché sur l'emprunt.
- **Compte des échéances** : le compte sur lequel les échéances sont prélevées. L'emprunt est dans sa devise.
- **Capital emprunté**, **taux annuel** (nominal : les intérêts d'un mois en sont un douzième) et **nombre d'échéances mensuelles**, différé compris.
- **Première échéance** : sa date ; les suivantes tombent le même jour de chaque mois (le dernier jour d'un mois plus court).
- **Assurance** : aucune, un taux sur le capital emprunté (l'assurance reste la même), ou un taux sur le capital restant (elle baisse avec lui). **Assurance hors de l'échéance** en fait une écriture à part, sur le compte de votre choix (celui des échéances par défaut), au lieu d'une partie de l'échéance.
- **Différé** : pendant les premiers mois, soit **intérêts seulement** (aucun capital n'est remboursé), soit **rien n'est payé** (les intérêts s'ajoutent au capital).
- **Sous-catégories** du capital, des intérêts et de l'assurance. Rembourser du capital, c'est épargner : choisissez pour lui une sous-catégorie d'une catégorie de nature **épargne**, et des sous-catégories de dépense pour les intérêts et l'assurance. Les catégories de virement ne sont pas proposées.

Les échéances sont constantes : les intérêts se calculent sur le capital restant, et le reste de l'échéance rembourse du capital. La dernière échéance prend ce qui reste. Les arrondis ou le calcul des jours d'une banque peuvent différer de quelques centimes.

## Évènements

Un évènement modifie l'échéancier à partir de sa date. Chacun peut avoir un **commentaire**, pour ce qui a été convenu. Il compte après l'échéance du même jour.

- **Déblocage** : capital libéré par étapes, comme pour un achat sur plan. Dès qu'un emprunt a des déblocages, seul ce qu'ils libèrent est emprunté ; leur total ne peut dépasser le capital.
- **Remboursement anticipé** : un montant, ou tout ce qui reste. Il peut avoir une **pénalité**, qui est un coût et non du capital : indiquez la **sous-catégorie des pénalités** (dépense) de l'emprunt pour en saisir une. Pour une partie, choisissez ce qu'il **conserve** : l'échéance (l'emprunt est plus court) ou la durée (l'échéance est plus basse).
- **Changement d'assureur** : à partir de sa date, l'assurance a de nouvelles conditions : aucune, un taux sur le capital emprunté ou sur le capital restant, dans l'échéance ou hors d'elle, sur un compte quelconque de la devise de l'emprunt. Il compte pour les échéances de ce jour et les suivantes.
- **Rachat** : l'emprunt est remboursé en entier par un autre. Une **pénalité** peut être saisie, comme pour un remboursement anticipé. Saisissez le nouvel emprunt comme un emprunt à part. Le nouveau prêteur paie l'ancien : aucune échéance n'est prévue pour le rachat.

## Taux effectif global (TEG)

L'emprunt affiche son **taux effectif global**, avec et sans l'assurance (une assurance à part compte) : le taux annuel qui rend le capital reçu égal à tout ce qui est payé. C'est celui de l'emprunt tel que contracté : seuls les déblocages comptent parmi les évènements, et le capital est supposé libéré un mois avant la première échéance. Les frais autres que l'assurance ne sont pas comptés.

## Capital restant

La liste donne le capital restant à la date choisie (aujourd'hui par défaut), la prochaine échéance et la dernière.

Le capital remboursé dans le journal est comparé à l'échéancier, mois par mois, sur les mois que couvre le journal : de la première écriture de la sous-catégorie du capital au dernier mois rapproché sur le compte des échéances. Un écart de plus d'une unité de la devise est signalé dans la liste et sur l'emprunt. Plusieurs emprunts qui partagent une sous-catégorie de capital sont comparés ensemble.

## Prévoir une année

Choisissez l'emprunt et l'année, puis **Prévoir**. Pour chaque échéance de l'année, le journal reçoit une [ventilation](04-journal.md) sur le compte des échéances : le capital, les intérêts et l'assurance, chacun dans sa sous-catégorie, avec le nom de l'emprunt pour description. Une assurance hors de l'échéance ne fait pas partie de la ventilation : c'est une écriture prévue à part, sur son compte. Une pénalité est une écriture prévue à part sur le compte des échéances, dans la sous-catégorie des pénalités. Une échéance d'une seule partie (un remboursement anticipé, ou des intérêts seuls sans assurance) est une écriture prévue ordinaire.

- Les **intérêts sont le solde** : à l'import d'un relevé, la ligne est rapprochée de l'échéance prévue et les intérêts prennent l'écart avec le montant de la banque, si bien que le capital reste celui de l'échéancier.
- **Prévoir** peut être relancé à tout moment, après un évènement par exemple. Il ajoute les échéances qui manquent au journal, remplace les prévisions qu'il a créées dont les montants ont changé (en gardant leur jour), et supprime celles que l'échéancier n'a plus. Une échéance rapprochée n'est jamais touchée.
- Une échéance saisie à la main, avec le même capital à moins de cinq jours, compte comme prévue.
- Supprimer un emprunt laisse dans le journal les écritures prévues à partir de lui.
- **Copier l'année précédente** dans le [budget](06-budget.md) ne copie pas les échéances d'un emprunt : prévoyez-les de nouveau.

La colonne Journal de l'échéancier montre ce que le journal contient pour chaque échéance : prévue ou rapprochée.
