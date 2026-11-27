# Relevés bancaires

**Importer un relevé**, dans le menu du livre, fait entrer dans le journal les lignes d'un export de la banque. Il est réservé aux éditeurs et aux propriétaires du livre : un relevé contient des numéros de compte et des libellés.

## 1. Lire le fichier

Choisissez le **compte**, le **format de la banque** et le **fichier CSV** exporté. ABN AMRO fournit un fichier `.xls` : ouvrez-le dans un tableur et enregistrez-le d'abord en CSV (séparateur `;`, virgule décimale). Le fichier est lu et affiché ligne par ligne, avec la somme des lignes et un avertissement quand les soldes de la banque ne se raccordent pas. Rien n'est encore enregistré.

**Garder pour la revue** enregistre les lignes comme un relevé dans la liste en dessous : la revue peut durer plusieurs séances. Une ligne qu'un relevé plus ancien du même compte contient déjà est marquée **Déjà vue** : deux exports qui se chevauchent ne comptent pas deux fois ce qu'ils ont en commun.

## 2. Revoir les lignes

**Ouvrez** un relevé gardé. Chaque ligne à revoir est l'une de ces choses :

- **Une nouvelle écriture** : choisissez sa sous-catégorie. La description est la contrepartie de la banque, et peut être réécrite.
- **Une écriture déjà dans le journal** : la ligne propose de la **pointer** au lieu de créer un doublon. Une écriture déjà pointée est proposée pour le **même montant** à **5 jours près**. Une **prévision** est proposée à **10 jours** près et à **10 %** près de son montant : une facture un peu plus forte que prévu est donc retrouvée, et elle prend alors le montant de la banque. Cliquez la proposition pour l'accepter. **Accepter les rapprochements proposés** ne prend que ceux du montant exact. Pour toute autre prévision, **Choisir une prévision** liste les prévisions libres du compte.

L'écran avertit des **prévisions de la période qu'aucune ligne n'est** : si une ligne est l'une d'elles, choisissez-la, sinon l'écriture sera créée en double.

- **Ignorée** : la ligne est laissée de côté, par exemple une ligne **déjà vue**, ou le côté d'un virement que vous avez saisi vous-même et déjà pointé.

- **Proposée par une règle** : voir plus bas. Les règles ne font que proposer ; **Accepter les propositions des règles** les valide.

Cochez plusieurs lignes pour leur donner la même sous-catégorie ou les ignorer ensemble. Les filtres montrent les lignes à revoir, validées, ignorées et importées.

### Les virements

Il n'y a pas de détection : **vous créez le virement depuis un côté**. Sur la ligne, **Virement avec le compte…** choisit l'autre compte du livre (même devise ; le livre doit avoir une sous-catégorie de transfert). L'import crée les deux côtés : celui du relevé, pointé, et l'autre, **non pointé**. Quand vous importez le relevé de l'autre compte, sa ligne **propose de pointer** ce côté. Annuler l'import supprime le virement, sauf si l'autre côté a été pointé entre-temps.

## Les règles

La section **Règles** de l'écran d'import liste les règles du livre, dans l'ordre où elles sont essayées : la première qui convient à une ligne l'emporte. Une règle a des **conditions** (le libellé contient un texte, la catégorie de la banque, entrées ou sorties d'argent, un montant minimum ou maximum) et des **actions** (une sous-catégorie, un moyen de paiement, une nouvelle description, ou ignorer la ligne). Les règles sont conservées avec le livre : vous pouvez les modifier, les réordonner ou les supprimer à tout moment. Supprimer une règle retire ce qu'elle proposait aux lignes pas encore acceptées.

Les règles sont essayées sur un relevé quand il est gardé, puis à nouveau avec **Essayer les règles**, qui suit les règles telles qu'elles sont pour les propositions que vous n'avez pas modifiées à la main. Elles ne font que proposer : la ligne montre sa sous-catégorie, avec le nom de la règle, et reste à revoir jusqu'à ce que vous l'acceptiez. Une ligne qui peut être rapprochée d'une écriture du journal n'est pas acceptée en bloc.

Quand vous classez une ligne à la main, une note propose de **créer une règle** pour elle, et dit combien d'autres lignes à revoir du relevé elle concernerait. **Créer une règle** reste disponible sur toute ligne qui a une sous-catégorie. Le formulaire est rempli avec la contrepartie de la ligne, pour que les relevés suivants demandent moins de travail. Le formulaire dit combien de lignes à revoir du relevé la règle concerne.

## Créer ce qui manque

Le **+** à côté d'une liste crée l'élément sans quitter l'écran, et le sélectionne :

- un **compte**, sur l'écran d'import et dans une règle (un compte bancaire, dans la devise du livre sauf si vous en choisissez une autre) ;
- une **sous-catégorie**, sur une ligne, pour les lignes cochées et dans une règle. Choisissez sa catégorie, ou créez-la avec un code, une nature et un groupe, qui peut être nouveau lui aussi. Depuis une ligne, le nom part de la catégorie de la banque ;
- un **moyen de paiement**, sur une ligne et dans une règle.

L'élément est nommé dans la langue par défaut du livre. Les autres noms, les couleurs et l'ordre se règlent dans les données de référence.

Dans une règle, **le libellé contient** cherche dans la contrepartie, le libellé et le mémo, sans tenir compte des majuscules ni des accents. Une **description** remplace la contrepartie de la banque dans l'écriture.

## 3. Importer

**Importer** écrit d'un coup les lignes validées dans le journal :

- une nouvelle ligne devient une écriture **pointée**, à la date de la banque ;
- une écriture rapprochée est **pointée** et prend la date de la banque (une prévision garde son [mois du budget](04-journal.md)), et pour une prévision le montant de la banque (le côté d'un virement garde sa date et son montant).

Quand plus aucune ligne n'est à revoir et que le relevé donne un solde, l'écran propose de **régler le solde initial** du compte pour que le compte corresponde au dernier solde du relevé. Il montre l'ancien et le nouveau montant ; la case n'est cochée d'office que si le compte n'a encore aucune écriture. Pour un compte dans une autre devise, indiquez le taux de change de l'import.

**Annuler l'import** supprime les écritures créées et rend aux écritures pointées leur date, leur montant et leur état ; les lignes redeviennent validées. Une écriture que vous avez modifiée ou supprimée depuis est laissée telle quelle. Le solde initial n'est pas rétabli.

Supprimer un relevé ne touche pas au journal. Ses lignes ne sont plus reconnues comme déjà vues.
