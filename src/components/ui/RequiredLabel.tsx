import React from "react";

interface RequiredLabelProps {
    children: React.ReactNode;
}

/**
 * Renders a label with a red asterisk to indicate a mandatory field.
 * The asterisk is added via the .required-label CSS class.
 */
export const RequiredLabel: React.FC<RequiredLabelProps> = ({ children }) => {
    return <span className="required-label">{children}</span>;
};
