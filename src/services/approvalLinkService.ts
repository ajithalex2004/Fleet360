import { ApprovalLink } from '@/types/maintenance';
import { v4 as uuidv4 } from 'uuid';

/**
 * Generate a secure approval link for email-based approvals
 */
export function generateApprovalLink(
    requestId: string,
    quotationId: string,
    approverEmail: string,
    approverName: string,
    expirationHours: number = 48
): ApprovalLink {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expirationHours * 60 * 60 * 1000);

    const approvalLink: ApprovalLink = {
        id: uuidv4(),
        token: uuidv4(), // In production, use JWT with signature
        requestId,
        quotationId,
        approverEmail,
        approverName,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        status: 'ACTIVE',
    };

    // TODO: Store in database
    console.log('Generated approval link:', approvalLink);

    return approvalLink;
}

/**
 * Validate an approval link token
 */
export function validateApprovalLink(token: string, approvalLinks: ApprovalLink[]): {
    valid: boolean;
    link?: ApprovalLink;
    error?: string;
} {
    const link = approvalLinks.find(l => l.token === token);

    if (!link) {
        return { valid: false, error: 'Invalid approval link' };
    }

    if (link.status === 'USED') {
        return { valid: false, error: 'This approval link has already been used' };
    }

    if (link.status === 'EXPIRED') {
        return { valid: false, error: 'This approval link has expired' };
    }

    const now = new Date();
    const expiresAt = new Date(link.expiresAt);

    if (now > expiresAt) {
        // Mark as expired
        link.status = 'EXPIRED';
        return { valid: false, error: 'This approval link has expired' };
    }

    return { valid: true, link };
}

/**
 * Mark approval link as used
 */
export function markApprovalLinkAsUsed(token: string, approvalLinks: ApprovalLink[]): ApprovalLink | null {
    const link = approvalLinks.find(l => l.token === token);

    if (!link) {
        return null;
    }

    link.status = 'USED';
    link.usedAt = new Date().toISOString();

    // TODO: Update in database
    console.log('Marked approval link as used:', link);

    return link;
}

/**
 * Generate approval URL for email
 */
export function getApprovalUrl(token: string, baseUrl: string = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'): string {
    return `${baseUrl}/maintenance/approve/${token}`;
}

/**
 * Generate rejection URL for email
 */
export function getRejectionUrl(token: string, baseUrl: string = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'): string {
    return `${baseUrl}/maintenance/reject/${token}`;
}

/**
 * Check if approval link is still valid (not expired or used)
 */
export function isApprovalLinkValid(link: ApprovalLink): boolean {
    if (link.status !== 'ACTIVE') {
        return false;
    }

    const now = new Date();
    const expiresAt = new Date(link.expiresAt);

    return now <= expiresAt;
}

/**
 * Get time remaining for approval link
 */
export function getTimeRemaining(link: ApprovalLink): {
    hours: number;
    minutes: number;
    expired: boolean;
} {
    const now = new Date();
    const expiresAt = new Date(link.expiresAt);
    const diff = expiresAt.getTime() - now.getTime();

    if (diff <= 0) {
        return { hours: 0, minutes: 0, expired: true };
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    return { hours, minutes, expired: false };
}
