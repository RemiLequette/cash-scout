# Relevés bancaires

**Importer un relevé**, dans le menu du livre, fait entrer dans le journal les lignes d'un export de la banque. Il est réservé aux éditeurs et aux propriétaires du livre : un relevé contient des numéros de compte et des libellés.

## 1. Lire le fichier

Choisissez le **compte**, le **format de la banque** et le **fichier CSV** exporté. Le fichier est lu et affiché ligne par ligne, avec la somme des lignes et un avertissement quand les soldes de la banque ne se raccordent pas. Rien n'est encore enregistré.

**Garder pour la revue** enregistre les lignes comme un relevé dans la liste en dessous : la revue peut durer plusieurs séances. Une ligne qu'un relevé plus ancien du même compte contient déjà est marquée **Déjà vue** : deux exports qui se chevauchent ne comptent pas deux fois ce qu'ils ont en commun.

## 2. Revoir les lignes

**Ouvrez** un relevé gardé. Chaque ligne à revoir est l'une de ces choses :

- **Une nouvelle écriture** : choisissez sa sous-catégorie. La description est la contrepartie de la banque, et peut être réécrite.
- **Une écriture déjà dans le journal** : quand une écriture du même compte a le **même montant** et une date à **5 jours près**, la ligne propose de la **pointer** au lieu de créer un doublon. Cliquez la proposition pour l'accepter, ou **Accepter les rapprochements proposés** pour toutes. Une prévision est proposée avant une écriture déjà pointée.
- **Ignorée** : la ligne est laissée de côté, par exemple une ligne **déjà vue**, ou un virement que vous saisissez vous-même.

- **Proposée par une règle** : voir plus bas. Les règles ne font que proposer ; **Accepter les propositions des règles** les valide.

Cochez plusieurs lignes pour leur donner la même sous-catégorie ou les ignorer ensemble. Les filtres montrent les lignes à revoir, validées, ignorées et importées.

## Les règles

La section **Règles** de l'écran d'import liste les règles du livre, dans l'ordre où elles sont essayées : la première qui convient à une ligne l'emporte. Une règle a des **conditions** (le libellé contient un texte, la catégorie de la banque, un compte, entrées ou sorties d'argent, un montant minimum ou maximum) et des **actions** (une sous-catégorie, une nouvelle description, ou ignorer la ligne).

Les règles sont essayées sur un relevé quand il est gardé, puis à nouveau avec **Essayer les règles**. Elles ne font que proposer : la ligne montre sa sous-catégorie, avec le nom de la règle, et reste à revoir jusqu'à ce que vous l'acceptiez. Une ligne qui peut être rapprochée d'une écriture du journal n'est pas acceptée en bloc.

Depuis une ligne qui a une sous-catégorie, **Créer une règle** remplit le formulaire avec la contrepartie de la ligne, pour que les relevés suivants demandent moins de travail. Le formulaire dit combien de lignes à revoir du relevé la règle concerne.

## 3. Importer

**Importer** écrit d'un coup les lignes validées dans le journal :

- une nouvelle ligne devient une écriture **pointée**, à la date de la banque ;
- une écriture rapprochée est **pointée** et prend la date de la banque (le côté d'un virement garde sa date).

Quand plus aucune ligne n'est à revoir et que le relevé donne un solde, l'écran propose de **régler le solde initial** du compte pour que le compte corresponde au dernier solde du relevé. Il montre l'ancien et le nouveau montant ; la case n'est cochée d'office que si le compte n'a encore aucune écriture. Pour un compte dans une autre devise, indiquez le taux de change de l'import.

**Annuler l'import** supprime les écritures créées et rend aux écritures pointées leur date et leur état ; les lignes redeviennent validées. Une écriture que vous avez modifiée ou supprimée depuis est laissée telle quelle. Le solde initial n'est pas rétabli.

Supprimer un relevé ne touche pas au journal. Ses lignes ne sont plus reconnues comme déjà vues.
