-- Store a bcrypt hash of the BIP39 recovery phrase (never the phrase itself)
ALTER TABLE "User" ADD COLUMN "recoveryPhraseHash" TEXT;
