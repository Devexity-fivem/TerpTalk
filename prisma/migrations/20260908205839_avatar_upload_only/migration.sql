/*
  Warnings:

  - You are about to drop the column `avatarEmoji` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `bannerColor` on the `Profile` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Profile" DROP COLUMN "avatarEmoji",
DROP COLUMN "bannerColor";
