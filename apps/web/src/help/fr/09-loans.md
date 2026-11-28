# Prêts

**Prêts** dans le menu liste les prêts du livre. Un prêt garde ses conditions et ses évènements ; son **échéancier** en est calculé, jamais saisi. À partir de lui, le prêt prévoit ses échéances dans le journal, que le budget et la projection de trésorerie voient alors.

## Conditions

- **Compte des échéances** : le compte sur lequel les échéances sont prélevées. Le prêt est dans sa devise.
- **Capital emprunté**, **taux annuel** (nominal : les intérêts d'un mois en sont un douzième) et **nombre d'échéances mensuelles**, différé compris.
- **Première échéance** : sa date ; les suivantes tombent le même jour de chaque mois (le dernier jour d'un mois plus court).
- **Assurance** : aucune, un taux sur le capital emprunté (l'assurance reste la même), ou un taux sur le capital restant (elle baisse avec lui).
- **Différé** : pendant les premiers mois, soit **intérêts seulement** (aucun capital n'est remboursé), soit **rien n'est payé** (les intérêts s'ajoutent au capital).
- **Sous-catégories** du capital, des intérêts et de l'assurance. Rembourser du capital, c'est épargner : choisissez pour lui une sous-catégorie d'une catégorie de nature **épargne**, et des sous-catégories de dépense pour les intérêts et l'assurance. Les catégories de virement ne sont pas proposées.

Les échéances sont constantes : les intérêts se calculent sur le capital restant, et le reste de l'échéance rembourse du capital. La dernière échéance prend ce qui reste. Les arrondis ou le calcul des jours d'une banque peuvent différer de quelques centimes.

## Évènements

Un évènement modifie l'échéancier à partir de sa date. Il compte après l'échéance du même jour.

- **Déblocage** : capital libéré par étapes, comme pour un achat sur plan. Dès qu'un prêt a des déblocages, seul ce qu'ils libèrent est emprunté ; leur total ne peut dépasser le capital.
- **Remboursement anticipé** : un montant, ou tout ce qui reste. Pour une partie, choisissez ce qu'il **conserve** : l'échéance (le prêt est plus court) ou la durée (l'échéance est plus basse).
- **Rachat** : le prêt est remboursé en entier par un autre. Saisissez le nouveau prêt comme un prêt à part. Le nouveau prêteur paie l'ancien : aucune échéance n'est prévue pour le rachat.

## Capital restant

La liste donne le capital restant à la date choisie (aujourd'hui par défaut), la prochaine échéance et la dernière.

Le capital remboursé dans le journal est comparé à l'échéancier, mois par mois, sur les mois que couvre le journal : de la première écriture de la sous-catégorie du capital au dernier mois rapproché sur le compte des échéances. Un écart de plus d'une unité de la devise est signalé dans la liste et sur le prêt. Plusieurs prêts qui partagent une sous-catégorie de capital sont comparés ensemble.

## Prévoir une année

Choisissez le prêt et l'année, puis **Prévoir**. Pour chaque échéance de l'année, le journal reçoit une [ventilation](04-journal.md) sur le compte des échéances : le capital, les intérêts et l'assurance, chacun dans sa sous-catégorie, avec le nom du prêt pour description. Une échéance d'une seule partie (un remboursement anticipé, ou des intérêts seuls sans assurance) est une écriture prévue ordinaire.

- Les **intérêts sont le solde** : à l'import d'un relevé, la ligne est rapprochée de l'échéance prévue et les intérêts prennent l'écart avec le montant de la banque, si bien que le capital reste celui de l'échéancier.
- **Prévoir** peut être relancé à tout moment, après un évènement par exemple. Il ajoute les échéances qui manquent au journal, remplace les prévisions qu'il a créées dont les montants ont changé (en gardant leur jour), et supprime celles que l'échéancier n'a plus. Une échéance rapprochée n'est jamais touchée.
- Une échéance saisie à la main, avec le même capital à moins de cinq jours, compte comme prévue.
- Supprimer un prêt laisse dans le journal les écritures prévues à partir de lui.
- **Copier l'année précédente** dans le [budget](06-budget.md) ne copie pas les échéances d'un prêt : prévoyez-les de nouveau.

La colonne Journal de l'échéancier montre ce que le journal contient pour chaque échéance : prévue ou rapprochée.
