'use client';

import { useState } from 'react';

interface UrlCopyButtonProps {
  url: string;
}

export const UrlCopyButton = ({ url }: UrlCopyButtonProps) => {
  const [copied, setCopied] = useState(false);

  const copyUrl = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      onClick={copyUrl}
      title="Copy URL"
      className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
    >
      {copied ? (
        <span className="text-xs text-green-600 font-medium whitespace-nowrap">
          Copied!
        </span>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
};
