-- CreateTable
CREATE TABLE "VerifyAttempt" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerifyAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerifyAttempt_staffId_createdAt_idx" ON "VerifyAttempt"("staffId", "createdAt");
