-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "communicationLanguage" TEXT,
ADD COLUMN     "dallasId" TEXT,
ADD COLUMN     "dateOfJoin" TIMESTAMP(3),
ADD COLUMN     "dob" TIMESTAMP(3),
ADD COLUMN     "driverType" TEXT,
ADD COLUMN     "emiratesId" TEXT,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "hierarchy" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "nationality" TEXT;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "chassisNumber" TEXT,
ADD COLUMN     "color" TEXT,
ADD COLUMN     "deviceId" TEXT,
ADD COLUMN     "emirate" TEXT,
ADD COLUMN     "fuelType" TEXT,
ADD COLUMN     "hierarchy" TEXT,
ADD COLUMN     "passengerCapacity" INTEGER,
ADD COLUMN     "plateCategory" TEXT,
ADD COLUMN     "plateCode" TEXT,
ADD COLUMN     "registrationNumber" TEXT,
ADD COLUMN     "simCardNumber" TEXT,
ADD COLUMN     "transmissionType" TEXT,
ADD COLUMN     "vehicleClass" TEXT,
ADD COLUMN     "vehicleGroup" TEXT,
ADD COLUMN     "vehicleUsage" TEXT;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mobileNumber" TEXT,
    "hierarchy" TEXT,
    "userType" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "department" TEXT,
    "position" TEXT,
    "employeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");
