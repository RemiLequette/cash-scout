# Bank statements

**Import a statement**, in the book's menu, brings the lines of a bank export into the journal. It is for editors and owners of the book: a statement holds account numbers and labels.

## 1. Read the file

Choose the **account**, the **format of the bank** and the exported **CSV file**. ABN AMRO gives an `.xls` file: open it in a spreadsheet and save it as CSV first (separator `;`, decimal comma). The file is read and shown line by line, with the sum of the lines and a warning when the balances of the bank do not follow. Nothing is saved yet.

**Keep for review** saves the lines as a statement in the list below, so the review can take several sittings. A line that an earlier statement of the same account already holds is marked **Seen before**: two exports that overlap do not count twice what they share.

## 2. Review the lines

**Open** a kept statement. Each line to review is one of:

- **A new entry**: choose its sub-category. The description is the bank's counterparty, and can be rewritten.
- **An entry already in the journal**: the line proposes to **reconcile** it instead of creating a duplicate. An entry already reconciled is proposed for the **same amount** within **5 days**. A **forecast** is proposed within **10 days** and within **10 %** of its amount, so a bill that came out a little higher is still found; it then takes the bank's amount. Click the proposal to accept it. **Accept the proposed matches** takes only those of the exact amount. For any other forecast, **Choose a forecast** lists the free forecasts of the account.

The screen warns about the **forecasts of the period that no line is**: if one of the lines is one of them, choose it, or the entry will be written twice.

- **Ignored**: the line is left out, for example a line **seen before**, or a side of a transfer you entered and reconciled yourself.

- **Proposed by a rule**: see below. Rules only propose; **Accept the proposals of the rules** validates them.

Tick several lines to give them the same sub-category or to ignore them together. The filters show the lines to review, validated, ignored and imported.

### Transfers

There is no detection: **you create the transfer from one side**. On the line, **Transfer with account…** chooses the other account of the book (same currency; the book needs a transfer sub-category). The import creates both sides: this statement's, reconciled, and the other, **not reconciled**. When you import the other account's statement, its line **proposes to reconcile** that side. Undoing the import removes the transfer, unless the other side was reconciled since.

## Rules

The **Rules** section of the import screen lists the rules of the book, in the order they are tried: the first that fits a line wins. A rule has **conditions** (the label contains a text, the bank's category, money in or out, a minimum or maximum amount) and **actions** (a sub-category, a payment type, a new description, or ignore the line). Rules are kept with the book: edit, reorder or delete them there at any time. Deleting a rule takes back what it proposed to lines not yet accepted.

Rules are tried on a statement when it is kept, and again with **Try the rules**, which follows the rules as they are now for the proposals you have not changed by hand. They only propose: the line keeps its sub-category in the list, tagged with the rule's name, and stays to review until you accept it. A line that could be reconciled with an entry of the journal is not accepted in bulk.

When you classify a line by hand, a note offers to **create a rule** for it, and says how many other lines to review of the statement it would reach. You can also use **Create a rule** on any line with a sub-category. The form is filled with the line's counterparty, so the next statements need less work. The form says how many lines to review of the statement the rule fits.

## Creating what is missing

The **+** beside a list creates the item without leaving the screen, and selects it:

- an **account**, on the import screen and in a rule (a bank account, in the book's currency unless you choose another);
- a **sub-category**, on a line, for the selected lines and in a rule. Pick its category, or create it with a code, a nature and a group, which can be new too. From a line, the name starts from the bank's category;
- a **payment type**, on a line and in a rule.

The item is named in the book's default language. Other names, colours and order are set in the reference data.

In a rule, **the label contains** looks in the counterparty, the label and the memo, ignoring case and accents. A **description** replaces the bank's counterparty in the entry.

## 3. Import

**Import** writes the validated lines into the journal in one go:

- a new line becomes a **reconciled** entry dated as the bank dates it;
- a matched entry becomes **reconciled** and takes the bank's date (a forecast keeps its [budget month](04-journal.md)), and for a forecast the bank's amount (the side of a transfer keeps its date and amount).

When no line is left to review and the statement gives a balance, the screen offers to **set the opening balance** of the account so that the account matches the statement's last balance. It shows the old and the new amount; it is ticked for you only when the account has no entry yet. For an account in another currency, give the exchange rate of the import.

**Undo the import** deletes the entries it created and gives the reconciled ones their date, amount and state back; the lines are validated again. An entry you changed or deleted since is left alone. The opening balance is not restored.

Deleting a statement does not touch the journal. Its lines are no longer recognised as seen before.
