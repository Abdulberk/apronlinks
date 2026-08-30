-- AlterTable
ALTER TABLE "Flight" ADD COLUMN     "actualOff" TIMESTAMPTZ(3),
ADD COLUMN     "actualOn" TIMESTAMPTZ(3);
