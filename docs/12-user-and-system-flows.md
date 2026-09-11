# User and system flows

Status: **Approved product flow; Phase 5 Selection Magic implementation and automated verification complete locally**

## 1. Complete Selection Magic flow

```mermaid
flowchart TD
    A[User selects visible text] --> B{Selection Magic active on this site?}
    B -- No --> C[Wait for context menu, shortcut, or popup]
    B -- Yes --> D[Wait for selection to stabilize]
    D --> E{Eligible new selection?}
    E -- No --> F[Ignore without storing or sending]
    E -- Yes --> G[Show magic icon beside selection]
    G --> H{User clicks icon?}
    H -- No --> F2[Keep text local and wait or dismiss]
    H -- Yes --> I[Open anchored translator]
    I --> J[Detect source language]
    J --> K[Load saved preferred target language]
    K --> L{Processing mode}
    L -- On-device only --> M{Local pair available?}
    M -- Yes --> N[Translate locally]
    M -- No --> O[Show unsupported local-pair message]
    L -- Online --> P{Online processing consent?}
    P -- No --> Q[Request consent before sending]
    P -- Yes --> R{Sensitive-text warning?}
    Q -- Accepted --> R
    Q -- Cancel --> T[Keep source locally and do not translate]
    R -- Yes --> R2[Pause and request confirmation]
    R -- No --> S[Send selected text to LingoBridge gateway]
    R2 -- Cancel --> T
    R2 -- Continue --> S
    S --> W{Exact NVIDIA pair supported?}
    W -- Yes --> Y[NVIDIA primary attempt]
    Y -- Success --> Z[Display result labelled NVIDIA]
    Y -- Failure --> U{Google backup configured and supported?}
    W -- No --> U
    U -- Yes --> V[Google Cloud Translation backup]
    V -- Success --> G2[Display result labelled Google]
    U -- No --> X[Show retry error and preserve source]
    V -- Failure --> X
    N --> AA[Display result labelled On-device]
    G2 --> AB
    Z --> AB
    AA --> AB
```

## 2. Onboarding and permission flow

```mermaid
flowchart TD
    A[Install LingoBridge] --> B[Choose preferred target language]
    B --> C[Explain On-device and Online processing]
    C --> D[Popup translation works without page access]
    D --> E{Enable Selection Magic?}
    E -- No --> F[Use popup, shortcut, or context menu]
    E -- Yes --> G[Explain what site access allows]
    G --> H{Access choice}
    H -- Recommended: current site --> I[Request current-origin permission]
    H -- Optional: all normal sites --> J[Request optional HTTP and HTTPS access]
    I --> K{Chrome permission granted?}
    J --> K
    K -- No --> F
    K -- Yes --> L[Activate lightweight selection observer]
    L --> M[Offer separate Online processing consent]
    M --> N[Selection Magic ready]
```

The permission and online-processing decisions are separate. Site access lets LingoBridge validate the active selection and show the magic icon. Clicking the icon is required before detection or translation starts, and Online consent separately controls whether the selected text may be sent to a provider.

## 2A. Explicit On-device preparation flow

```mermaid
flowchart TD
    A[User clicks Enable On-device] --> B[Check Chrome Translator availability]
    B -- Available --> C[Enable requested pair]
    B -- Downloadable --> D[Show Prepare language pair]
    D --> E[User clicks Prepare]
    E --> F[Create translator with user activation]
    F --> G[Show download progress when Chrome reports it]
    G --> C
    B -- Unavailable --> H[Keep pair disabled and explain limitation]
    F -- Failure --> H
```

LingoBridge does not promise a model-download size because Chrome does not expose one reliably. Preparing a pair never changes the user's Online preference or silently sends source text to a provider.

## 3. Selection eligibility flow

Before showing the magic icon, LingoBridge evaluates the active range in this order:

1. Confirm the event came from a completed pointer or keyboard selection action.
2. Wait briefly and verify that the selection is no longer changing.
3. Reject a collapsed or whitespace-only range.
4. Reject text beyond the configured character or byte limit.
5. Reject password fields, hidden content, extension UI, and unsupported browser pages.
6. Reject the same unchanged range if it was already handled.
7. Capture only the active selected text and its visible bounding rectangle.
8. Show one magic icon; never stack multiple icons or panels.
9. Start language detection and translation only after the user clicks the icon.

## 4. Language detection and target flow

```mermaid
flowchart LR
    A[User clicks selection magic icon] --> B{Local detector available?}
    B -- Yes --> C[Detect locally]
    B -- No --> D{Online processing allowed?}
    D -- Yes --> E[Use Google backup detection when configured]
    D -- No --> F[Ask user to choose source]
    C --> G{Confidence sufficient?}
    G -- No --> F
    G -- Yes --> H[Show detected source]
    E --> H
    H --> I[Load preferred target]
    I --> J{Source equals target?}
    J -- No --> K[Continue translation]
    J -- Yes --> L[Use recent different target or ask user]
```

User correction always overrides automatic detection for the current translation.

## 5. Provider routing flow

```mermaid
sequenceDiagram
    participant U as User
    participant E as LingoBridge extension
    participant G as LingoBridge gateway
    participant N as NVIDIA Riva
    participant T as Google Translation

    U->>E: Select eligible text
    E-->>U: Show magic icon beside selection
    U->>E: Click magic icon
    E->>E: Detect language, load preferred target, and check consent
    E->>G: Translation request
    G->>G: Validate request, pair, size, rate and consent
    G->>G: Check exact NVIDIA pair allowlist
    alt NVIDIA pair supported
        G->>N: Primary translation request
        alt NVIDIA succeeds
            N-->>G: Translation
            G-->>E: Result with provider NVIDIA
        else NVIDIA fails
            G->>G: Check Google backup configuration and consent
            alt Google backup available
                G->>T: Backup translation request
                T-->>G: Translation
                G-->>E: Result with provider Google
            else No backup
                G-->>E: Safe retryable error
            end
        end
    else NVIDIA pair unsupported
        G->>G: Check Google backup configuration and consent
        alt Google backup available
            G->>T: Backup translation request
            T-->>G: Translation
            G-->>E: Result with provider Google
        else No backup
            G-->>E: Safe retryable error
        end
    end
    E-->>U: Show labelled result or error
```

Nepali requests never enter the selected NVIDIA adapter because `riva-translate-4b-instruct-v2` does not support Nepali. They require Google backup to be configured.

## 6. Anchored translator lifecycle

```mermaid
stateDiagram-v2
    [*] --> Closed
    Closed --> IconVisible: eligible stable selection
    IconVisible --> Opening: magic icon click
    Opening --> Detecting
    Detecting --> Translating: source resolved
    Detecting --> NeedsSource: uncertain or unavailable
    NeedsSource --> Translating: user chooses source
    Translating --> Result: provider succeeds
    Translating --> NeedsConfirmation: sensitive text detected
    NeedsConfirmation --> Translating: user continues
    NeedsConfirmation --> Closed: user cancels
    Translating --> Error: no provider succeeds
    Error --> Translating: retry
    Result --> Translating: pair, style, or text changes
    Result --> Closed: Escape or Close
    Error --> Closed: Escape or Close
    IconVisible --> Closed: Escape, new selection, or selection lost
    Opening --> Closed: selection lost
    Detecting --> Closed: new unrelated selection
    Translating --> Closed: navigation or access revoked
    Closed --> [*]
```

Scroll, resize, and zoom reposition the same icon or translator without creating another translation request.

## 7. Translator surface flow

The anchored surface follows the reference layout in a compact form:

1. Clicking the magic icon opens the surface; merely selecting text does not start detection or translation.
2. The top row contains detected source, swap, and target-language controls, with the saved preferred target selected by default.
3. The source remains visible beside or above the translation, depending on available space.
4. The result area announces detecting, loading, success, warning, and failure states accessibly.
5. Copy copies only the translation.
6. Listen appears only where speech is supported.
7. Save stores the chosen source and translation locally.
8. Replace appears only for an editable selection and requires review.
9. Close removes the icon or surface and temporary selection data.

## 8. Editable-field replacement flow

```mermaid
flowchart TD
    A[Select text in editable field] --> B[Translate and review]
    B --> C{User action}
    C -- Copy --> D[Copy translated text]
    C -- Replace --> E[Confirm selected range is still valid]
    E -- Invalid --> F[Keep original and ask user to select again]
    E -- Valid --> G[Replace selected range only]
    G --> H[Dispatch normal input event]
    H --> I[Do not submit, send, click, or press Enter]
```

## 9. Capability-catalogue flow

1. Open the language picker immediately using the last-known-good local catalogue.
2. Ask the LingoBridge gateway for the current capability version.
3. Validate the response before replacing the local catalogue.
4. Enable NVIDIA only for reviewed exact pair tags.
5. Enable Google backup for current Google-supported directions when configured.
6. Gate speech, transliteration, styles, and on-device mode independently.
7. If refresh fails, keep the cached catalogue and mark it as stale.

## 10. Dismissal and cleanup flow

Temporary selection data is cleared when any of these occurs:

- the user presses Escape or Close;
- the user makes a new unrelated selection;
- the selected range disappears;
- the tab navigates or closes;
- site access is revoked;
- the five-minute maximum expiry is reached.

Saved phrases remain only when the user explicitly chooses Save. Closing the translator never creates history automatically.

## 11. Restricted and unsupported contexts

- Chrome internal pages, the Chrome Web Store, and other restricted schemes cannot host the automatic translator; use the popup instead.
- Canvas, WebGL, images, video text, and other non-selectable visual content are outside version 1.
- Closed Shadow DOM content may be unavailable to the selection observer.
- Cross-origin iframe behaviour depends on granted access and is tested separately.
- Missing or revoked access never triggers repeated permission prompts from a selection event.

## 12. Connect extension to dashboard

```mermaid
sequenceDiagram
    participant U as User
    participant E as LingoBridge extension
    participant I as Identity service
    participant A as LingoBridge API
    participant D as Dashboard

    U->>E: Click Connect dashboard
    E->>E: Create PKCE verifier and challenge
    E->>I: Start interactive authorization
    I-->>U: Show sign-in and consent
    I-->>E: Redirect with one-time authorization code
    E->>A: Exchange code and PKCE verifier
    A-->>E: Short-lived access and revocable extension session
    E-->>U: Show Connected
    U->>D: Open dashboard
    D->>I: Use secure web session
    D-->>U: Show the same account's saved data
```

Translation remains available if the user skips, cancels, or later revokes dashboard connection.

## 13. Saved-phrase synchronization

```mermaid
flowchart TD
    A[User chooses Save in extension] --> B[Commit phrase locally]
    B --> C{Signed in and sync enabled?}
    C -- No --> D[Keep local only]
    C -- Yes --> E[Queue idempotent upsert]
    E --> F[API validates account, size, and revision]
    F -- Accepted --> G[Store under authenticated user]
    G --> H[Dashboard and connected extensions receive new revision]
    F -- Offline or retryable failure --> I[Keep local and retry with bounded backoff]
    F -- Rejected --> J[Keep local and show sync error]
```

Unsaved translation results never enter this flow.

## 14. Dashboard deletion and session revocation

1. Deleting one phrase creates a deletion revision and removes it from connected clients.
2. Delete all phrases requires explicit confirmation and does not delete the account.
3. Revoking an extension session invalidates that installation's next authenticated request.
4. Account deletion requires recent authentication and explicit confirmation.
5. Account deletion revokes all sessions, creates a deletion receipt, and starts the documented retention process.
6. The extension asks whether unsynchronized local phrases should remain or be deleted locally.

## 15. Admin operations flow

```mermaid
flowchart LR
    A[Translation gateway] --> B[Remove text and direct identifiers]
    B --> C[Aggregate provider, language code, outcome, latency, fallback, and count]
    C --> D[Role-protected admin API]
    D --> E[Admin operations dashboard]
    E --> F[Monitor availability, errors, latency, quotas, and fallback]
```

The admin path never receives selected text, translated text, saved phrases, access tokens, or provider secrets.
