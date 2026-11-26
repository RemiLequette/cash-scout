import type { StatementPreset } from "./file.js";

/**
 * Boursorama's "export operations" CSV. Two columns are called "Solde": the first holds the
 * amount of the line, the second the balance of the account after it, so both go by position.
 */
export const boursorama: StatementPreset = {
  id: "boursorama",
  name: "Boursorama",
  file: { kind: "csv", encoding: "utf-8", delimiter: ";" },
  mapping: {
    date: "Date Opération",
    valueDate: "Date Valeur",
    label: "Libellé",
    counterparty: "Libellé Suggéré",
    bankCategory: "Catégorie",
    amount: 6,
    balance: 10,
    accountNumber: "Numéro Compte",
    dateFormat: "iso",
    decimal: ",",
    // The balance has a decimal point, the amounts a comma.
    balanceDecimal: ".",
  },
};

/** Caisse d'Epargne's CSV: debit and credit columns, no balance. */
export const caisseEpargne: StatementPreset = {
  id: "caisse-epargne",
  name: "Caisse d'Epargne",
  file: { kind: "csv", encoding: "utf-8", delimiter: ";" },
  mapping: {
    date: "Date operation",
    valueDate: "Date de valeur",
    label: "Libelle operation",
    counterparty: "Libelle simplifie",
    memo: "Informations complementaires",
    reference: "Reference",
    bankCategory: ["Categorie", "Sous categorie"],
    debit: "Debit",
    credit: "Credit",
    dateFormat: "dmy",
    decimal: ",",
  },
};

/**
 * ABN AMRO's statement is a `.xls` file; this reads it saved as CSV from a spreadsheet
 * (French settings: `;` and decimal comma, UTF-8 or ANSI). The counterparty is the `NAME`
 * of the structured description; card payments have none.
 */
export const abnAmro: StatementPreset = {
  id: "abn-amro",
  name: "ABN AMRO",
  file: { kind: "csv", encoding: "auto", delimiter: ";" },
  mapping: {
    date: "transactiondate",
    valueDate: "valuedate",
    label: "description",
    counterpartyTag: "NAME",
    amount: "amount",
    balance: "endsaldo",
    accountNumber: "accountNumber",
    dateFormat: "yyyymmdd",
    decimal: ",",
  },
};

export const presets: StatementPreset[] = [boursorama, caisseEpargne, abnAmro];
