import {
    EnhancedGarage,
    MaintenanceRequest,
    MaintenanceType,
    GarageMatch
} from '@/types/maintenance';

/**
 * Garage Matching Service
 * Automatically matches garages based on job requirements and garage specialties
 */

/**
 * Extract keywords from job description
 */
function extractKeywords(description: string): string[] {
    // Common maintenance-related keywords
    if (!description) return [];
    const keywords = description.toLowerCase().match(/\b\w+\b/g) || [];

    // Filter out common words
    const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'is', 'was', 'are', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can'];

    return keywords.filter(word => !stopWords.includes(word) && word.length > 2);
}

/**
 * Calculate match score between a maintenance request and a garage
 * Score is 0-100, where 100 is a perfect match
 */
export function calculateMatchScore(
    request: MaintenanceRequest,
    garage: EnhancedGarage
): number {
    let score = 0;

    // 0. Automatic Shortlist for "General Services" (80 points)
    // If a garage offers General Services, it is capable of handling most requests.
    const isGeneralService = garage.specialties?.some(s => s.toLowerCase().includes('general service'));
    if (isGeneralService) {
        score += 80;
    }

    // 1. Match maintenance type (20 points)
    if (request.maintenanceType && garage.services?.includes(request.maintenanceType)) {
        score += 20;
    }

    // 2. Match Maintenance Jobs (50 points) - HIGH PRIORITY
    // This looks for explicit job matches (e.g. "Oil Change") in the garage's specialties
    if (request.maintenanceJobs && request.maintenanceJobs.length > 0) {
        const garageSpecialties = (garage.specialties || []).map(s => s.toLowerCase());

        const matchedJobs = request.maintenanceJobs.filter(job => {
            const jobLower = job.toLowerCase();
            // Check if garage has this job explicitly listed or as part of a specialty string
            return garageSpecialties.some(specialty =>
                specialty.includes(jobLower) || jobLower.includes(specialty)
            );
        });

        const jobMatchRatio = matchedJobs.length / request.maintenanceJobs.length;
        score += Math.round(jobMatchRatio * 50);
    } else {
        // Fallback if no jobs specified: use Maintenance Type score boost
        // If type matches, give extra points to simulate job matching
        if (request.maintenanceType && garage.services?.includes(request.maintenanceType)) {
            score += 20;
        }
    }

    // 3. Match specialties from description (10 points)
    // Less weight now that we have explicit jobs
    const keywords = extractKeywords(request.description);
    if (keywords.length > 0) {
        const matchedSpecialties = garage.specialties?.filter(specialty =>
            keywords.some(keyword =>
                specialty.toLowerCase().includes(keyword) ||
                keyword.includes(specialty.toLowerCase())
            )
        ) || [];

        if (garage.specialties?.length > 0) {
            const specialtyMatchRatio = matchedSpecialties.length / garage.specialties.length;
            score += Math.round(specialtyMatchRatio * 10);
        }
    }

    // 4. Performance factors (20 points)
    if (garage.rating && garage.rating >= 4) {
        score += 10;
    }
    if (garage.averageCompletionTime && garage.averageCompletionTime <= 3) {
        score += 5; // Fast turnaround
    }
    if (garage.completedJobs && garage.completedJobs > 10) {
        score += 5; // Experience
    }

    return Math.min(Math.round(score), 100);
}

/**
 * Match garages for a maintenance request
 * Returns a ranked list of garages with match scores
 */
export function matchGarages(
    request: MaintenanceRequest,
    allGarages: EnhancedGarage[],
    minScore: number = 30
): GarageMatch[] {
    const matches: GarageMatch[] = [];

    for (const garage of allGarages) {
        const score = calculateMatchScore(request, garage);

        if (score >= minScore) {
            // Find matched specialties
            const keywords = extractKeywords(request.description);
            const matchedSpecialties = garage.specialties?.filter(specialty =>
                keywords.some(keyword =>
                    specialty.toLowerCase().includes(keyword) ||
                    keyword.includes(specialty.toLowerCase())
                )
            ) || [];

            // Find matched services
            const matchedServices = garage.services?.filter(service =>
                service === request.maintenanceType
            ) || [];

            matches.push({
                garageId: garage.id,
                garageName: garage.name,
                matchScore: score,
                matchedSpecialties,
                matchedServices
            });
        }
    }

    // Sort by match score (highest first)
    matches.sort((a, b) => b.matchScore - a.matchScore);

    return matches;
}

/**
 * Get top N matched garages
 */
export function getTopMatches(
    request: MaintenanceRequest,
    allGarages: EnhancedGarage[],
    topN: number = 5
): GarageMatch[] {
    const allMatches = matchGarages(request, allGarages);
    return allMatches.slice(0, topN);
}

/**
 * Filter garages by specialty
 */
export function filterBySpecialty(
    garages: EnhancedGarage[],
    specialty: string
): EnhancedGarage[] {
    return garages.filter(garage =>
        garage.specialties.some(s =>
            s.toLowerCase().includes(specialty.toLowerCase())
        )
    );
}

/**
 * Filter garages by service type
 */
export function filterByService(
    garages: EnhancedGarage[],
    serviceType: MaintenanceType
): EnhancedGarage[] {
    return garages.filter(garage =>
        garage.services?.includes(serviceType)
    );
}

/**
 * Get garage recommendations based on performance
 */
export function getRecommendedGarages(
    garages: EnhancedGarage[],
    minRating: number = 4.0
): EnhancedGarage[] {
    return garages
        .filter(garage => (garage.rating || 0) >= minRating)
        .sort((a, b) => (b.rating || 0) - (a.rating || 0));
}

/**
 * Calculate estimated cost based on garage's average cost
 */
export function estimateCost(
    garage: EnhancedGarage,
    maintenanceType: MaintenanceType
): number {
    // Base cost from garage average
    let estimatedCost = garage.averageCost || 500;

    // Adjust based on maintenance type
    switch (maintenanceType) {
        case MaintenanceType.EMERGENCY:
            estimatedCost *= 1.5; // 50% premium for emergency
            break;
        case MaintenanceType.PREVENTIVE:
            estimatedCost *= 0.8; // 20% discount for preventive
            break;
        case MaintenanceType.CORRECTIVE:
            estimatedCost *= 1.0; // Standard rate
            break;
        case MaintenanceType.INSPECTION:
            estimatedCost *= 0.5; // 50% of standard for inspection
            break;
    }

    return Math.round(estimatedCost);
}

/**
 * Get match score color for UI display
 */
export function getMatchScoreColor(score: number): string {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    if (score >= 40) return 'text-orange-600';
    return 'text-red-600';
}

/**
 * Get match score badge color
 */
export function getMatchScoreBadge(score: number): string {
    if (score >= 80) return 'bg-green-100 text-green-700 border-green-300';
    if (score >= 60) return 'bg-yellow-100 text-yellow-700 border-yellow-300';
    if (score >= 40) return 'bg-orange-100 text-orange-700 border-orange-300';
    return 'bg-red-100 text-red-700 border-red-300';
}

/**
 * Get match quality label
 */
export function getMatchQuality(score: number): string {
    if (score >= 80) return 'Excellent Match';
    if (score >= 60) return 'Good Match';
    if (score >= 40) return 'Fair Match';
    return 'Poor Match';
}
