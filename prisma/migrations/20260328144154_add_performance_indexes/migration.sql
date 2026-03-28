-- CreateIndex
CREATE INDEX "CheckIn_date_idx" ON "CheckIn"("date");

-- CreateIndex
CREATE INDEX "CheckIn_userId_idx" ON "CheckIn"("userId");

-- CreateIndex
CREATE INDEX "User_role_grade_classNum_number_idx" ON "User"("role", "grade", "classNum", "number");
