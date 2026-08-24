const MODE_LABELS = {
  oid: "OpenID Connect",
  saml: "SAML",
};

const setStatus = (element, message, isError = false) => {
  element.textContent = message;
  element.classList.toggle("sso-status-error", isError);
};

const requestJson = (url) =>
  ApiClient.fetch({
    type: "GET",
    url,
    dataType: "json",
    headers: { accept: "application/json" },
  });

const encodePathSegment = (value) => encodeURIComponent(String(value));

const applyPageStyles = () => {
  if (document.querySelector("#linking-style")) return;

  const style = document.createElement("link");
  style.id = "linking-style";
  style.rel = "stylesheet";
  style.href = `${ApiClient.getUrl("web/configurationpage")}?name=SSO-Auth-linking.css`;
  document.head.appendChild(style);
};

const ssoConfigLinking = {
  loadProviders: (view) => {
    void Promise.all([
      ssoConfigLinking.loadProviderMode(view, "saml"),
      ssoConfigLinking.loadProviderMode(view, "oid"),
    ]).then(() => ssoConfigLinking.updateDeleteButton(view));
  },

  loadProviderMode: async (view, providerMode) => {
    const container = view.querySelector(`#sso-provider-list-${providerMode}`);
    const currentUserId = ApiClient.getCurrentUserId();

    container.replaceChildren();
    container.setAttribute("aria-busy", "true");
    const loading = document.createElement("p");
    loading.className = "sso-status";
    loading.setAttribute("role", "status");
    loading.textContent = "Loading providers…";
    container.appendChild(loading);

    try {
      if (!currentUserId) {
        throw new Error("No authenticated Jellyfin user is available.");
      }

      const [providers, providerMap] = await Promise.all([
        requestJson(ApiClient.getUrl(`sso/${providerMode}/GetNames`)),
        requestJson(
          ApiClient.getUrl(
            `sso/${providerMode}/links/${encodePathSegment(currentUserId)}`,
          ),
        ),
      ]);

      if (!Array.isArray(providers)) {
        throw new Error("The server returned an invalid provider list.");
      }

      ssoConfigLinking.loadProviderList(
        container,
        providers,
        providerMode,
        providerMap || {},
      );
    } catch (error) {
      console.error(`Unable to load ${providerMode} providers`, error);
      container.replaceChildren();

      const message = document.createElement("p");
      message.className = "sso-status sso-status-error";
      message.setAttribute("role", "alert");
      message.textContent = `Unable to load ${MODE_LABELS[providerMode]} providers.`;

      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "raised emby-button";
      retry.textContent = "Retry";
      retry.addEventListener("click", () =>
        ssoConfigLinking.loadProviderMode(view, providerMode),
      );

      container.append(message, retry);
    } finally {
      container.setAttribute("aria-busy", "false");
    }
  },

  loadProviderList: (container, providers, providerMode, providerMap) => {
    container.replaceChildren();

    if (providers.length === 0) {
      const emptyState = document.createElement("p");
      emptyState.className = "sso-status";
      emptyState.textContent = "No providers configured.";
      container.appendChild(emptyState);
      return;
    }

    providers.forEach((providerName) => {
      const providerConfig = document.createElement("div");
      providerConfig.className = "sso-provider-links-container";
      providerConfig.dataset.id = providerName;

      const title = document.createElement("div");
      title.className =
        "inputLabel inputLabelUnfocused sso-provider-link-title";
      title.textContent = providerName;

      const addProvider = document.createElement("button");
      addProvider.type = "button";
      addProvider.className =
        "raised emby-button sso-provider-add-link sso-provider";
      addProvider.setAttribute("aria-label", `Link ${providerName}`);
      addProvider.title = `Link ${providerName}`;

      const addIcon = document.createElement("span");
      addIcon.className = "sso-action-icon";
      addIcon.setAttribute("aria-hidden", "true");
      addIcon.textContent = "+";
      const addLabel = document.createElement("span");
      addLabel.textContent = "Link";
      addProvider.append(addIcon, addLabel);
      addProvider.addEventListener("click", (event) =>
        ssoConfigLinking.handleAddLink(event, providerMode, providerName),
      );

      const existingLinks = document.createElement("div");
      existingLinks.className = "sso-provider-existing-links-container";
      existingLinks.dataset.provider = providerName;

      providerConfig.append(title, addProvider, existingLinks);
      container.appendChild(providerConfig);

      ssoConfigLinking.populateExistingLinks(
        existingLinks,
        providerMode,
        providerName,
        providerMap[providerName],
      );
    });
  },

  handleAddLink: async (event, providerMode, providerName) => {
    const button = event.currentTarget;
    const pageStatus = document.querySelector("#page-status");

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    setStatus(pageStatus, `Opening ${providerName}…`);

    try {
      const response = await ApiClient.fetch({
        type: "POST",
        url: ApiClient.getUrl(
          `sso/${providerMode}/startlink/${encodePathSegment(providerName)}`,
        ),
      });
      const redirectUrl = (
        typeof response === "string" ? response : await response.text()
      ).trim();

      if (!redirectUrl) {
        throw new Error("The server returned an empty SSO redirect URL.");
      }

      const destination = new URL(redirectUrl, window.location.href);
      if (!new Set(["http:", "https:"]).has(destination.protocol)) {
        throw new Error("The server returned an unsupported redirect URL.");
      }

      window.location.assign(destination.href);
    } catch (error) {
      console.error("Unable to start the SSO linking flow", error);
      setStatus(
        pageStatus,
        `Unable to start linking with ${providerName}. Please try again.`,
        true,
      );
      button.disabled = false;
      button.setAttribute("aria-busy", "false");
    }
  },

  populateExistingLinks: (
    container,
    providerMode,
    providerName,
    canonicalNames,
  ) => {
    container.replaceChildren();

    if (!Array.isArray(canonicalNames) || canonicalNames.length === 0) return;

    const label = document.createElement("p");
    label.className = "sso-linked-label";
    label.textContent = "Linked identities";
    container.appendChild(label);

    canonicalNames.forEach((canonicalName) => {
      const wrapper = document.createElement("label");
      wrapper.className = "sso-provider-link-checkbox-wrapper checkbox-wrapper";

      const checkbox = document.createElement("input");
      checkbox.className = "sso-link-checkbox";
      checkbox.dataset.id = canonicalName;
      checkbox.dataset.mode = providerMode;
      checkbox.dataset.provider = providerName;
      checkbox.type = "checkbox";

      const checkboxLabel = document.createElement("span");
      checkboxLabel.className = "checkbox-label";
      checkboxLabel.textContent = canonicalName;

      wrapper.append(checkbox, checkboxLabel);
      container.appendChild(wrapper);
    });
  },

  selectedLinks: (view) => [
    ...view.querySelectorAll(".sso-link-checkbox:checked"),
  ],

  updateDeleteButton: (view) => {
    const deleteEnabled = view.querySelector("#enable-delete").checked;
    const hasSelection = ssoConfigLinking.selectedLinks(view).length > 0;
    view.querySelector("#btn-delete-selected-links").disabled =
      !deleteEnabled || !hasSelection;
  },

  handleDeleteButtonPressed: async (event, view) => {
    const button = event.currentTarget;
    const selectedLinks = ssoConfigLinking.selectedLinks(view);
    const currentUserId = ApiClient.getCurrentUserId();
    const deleteStatus = view.querySelector("#delete-status");

    if (button.disabled || !currentUserId || selectedLinks.length === 0) return;

    const noun = selectedLinks.length === 1 ? "link" : "links";
    if (
      !window.confirm(
        `Delete ${selectedLinks.length} selected SSO ${noun}? You may lose access if no other sign-in method is available.`,
      )
    ) {
      return;
    }

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    setStatus(deleteStatus, `Deleting ${selectedLinks.length} ${noun}…`);

    try {
      await Promise.all(
        selectedLinks.map((link) =>
          ApiClient.fetch({
            type: "DELETE",
            url: ApiClient.getUrl(
              `sso/${link.dataset.mode}/link/${encodePathSegment(link.dataset.provider)}/${encodePathSegment(currentUserId)}/${encodePathSegment(link.dataset.id)}`,
            ),
          }),
        ),
      );

      setStatus(deleteStatus, `Deleted ${selectedLinks.length} ${noun}.`);
      window.location.reload();
    } catch (error) {
      console.error("Unable to delete selected SSO links", error);
      setStatus(
        deleteStatus,
        "Unable to delete the selected links. Review your selection and try again.",
        true,
      );
      button.setAttribute("aria-busy", "false");
      ssoConfigLinking.updateDeleteButton(view);
    }
  },
};

export default function (view) {
  applyPageStyles();
  ssoConfigLinking.loadProviders(view);

  view.addEventListener("change", (event) => {
    if (
      event.target.matches("#enable-delete") ||
      event.target.matches(".sso-link-checkbox")
    ) {
      ssoConfigLinking.updateDeleteButton(view);
    }
  });

  view
    .querySelector("#btn-delete-selected-links")
    .addEventListener("click", (event) =>
      ssoConfigLinking.handleDeleteButtonPressed(event, view),
    );
}
