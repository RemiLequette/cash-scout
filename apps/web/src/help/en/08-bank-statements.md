# Bank statements

**Import a statement**, in the book's menu, brings the lines of a bank export into the journal. It is for editors and owners of the book: a statement holds account numbers and labels.

## 1. Read the file

Choose the **account**, the **format of the bank** and the exported **CSV file**. The file is read and shown line by line, with the sum of the lines and a warning when the balances of the bank do not follow. Nothing is saved yet.

**Keep for review** saves the lines as a statement in the list below, so the review can take several sittings. A line that an earlier statement of the same account already holds is marked **Seen before**: two exports that overlap do not count twice what they share.

## 2. Review the lines

**Open** a kept statement. Each line to review is one of:

- **A new entry**: choose its sub-category. The description is the bank's counterparty, and can be rewritten.
- **An entry already in the journal**: when an entry of the same account has the **same amount** and a date within **5 days**, the line proposes to **reconcile** it instead of creating a duplicate. Click the proposal to accept it, or **Accept the proposed matches** for all of them. A forecast is proposed before an entry that is already reconciled.
- **Ignored**: the line is left out, for example a line **seen before**, or one you enter as a transfer yourself.

- **Proposed by a rule**: see below. Rules only propose; **Accept the proposals of the rules** validates them.

Tick several lines to give them the same sub-category or to ignore them together. The filters show the lines to review, validated, ignored and imported.

## Rules

The **Rules** section of the import screen lists the rules of the book, in the order they are tried: the first that fits a line wins. A rule has **conditions** (the label contains a text, the bank's category, an account, money in or out, a minimum or maximum amount) and **actions** (a sub-category, a new description, or ignore the line).

Rules are tried on a statement when it is kept, and again with **Try the rules**. They only propose: the line keeps its sub-category in the list, tagged with the rule's name, and stays to review until you accept it. A line that could be reconciled with an entry of the journal is not accepted in bulk.

From a line with a sub-category, **Create a rule** fills the form with the line's counterparty, so the next statements need less work. The form says how many lines to review of the statement the rule fits.

## 3. Import

**Import** writes the validated lines into the journal in one go:

- a new line becomes a **reconciled** entry dated as the bank dates it;
- a matched entry becomes **reconciled** and takes the bank's date (the side of a transfer keeps its date).

When no line is left to review and the statement gives a balance, the screen offers to **set the opening balance** of the account so that the account matches the statement's last balance. It shows the old and the new amount; it is ticked for you only when the account has no entry yet. For an account in another currency, give the exchange rate of the import.

**Undo the import** deletes the entries it created and gives the reconciled ones their date and state back; the lines are validated again. An entry you changed or deleted since is left alone. The opening balance is not restored.

Deleting a statement does not touch the journal. Its lines are no longer recognised as seen before.
