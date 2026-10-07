# Provider Specific Configuration

This plugin has been tested to work against various providers, though not all providers provide support for all of this plugins' features.

❗ If you plan to link SSO to your only Jellyfin administrator account, create another administrator account first. SSO can change account permissions (see [the original issue #212](https://github.com/9p4/jellyfin-plugin-sso/issues/212)).

## TOC / Tested Providers:

This section is broken into providers that support Role-Based Access Control (RBAC), and those that do not

### Providers that support RBAC

- ✅ [Authelia](#authelia)
- ✅ [authentik](#authentik)
- ✅ [Keycloak](#keycloak-oidc)
  - Both [OIDC](#keycloak-oidc) & [SAML](#keycloak-saml)
- ✅ [Pocket ID](#pocket-id)

### No RBAC Support

- ✅ Google OIDC
  - ❗ Usernames are numeric
  - ❗ Requires disabling validating OpenID endpoints

## Common RBAC settings

These access settings apply to providers that supply roles or groups. For OIDC, configure them in the plugin's **SSO Settings** page under **Add / Update Provider Configuration**. The UI does not support SAML provider configuration; use the [SAML configuration API](README.md#saml-1) for SAML. The provider examples below focus on connection and claim settings, so also set these access options as needed. Replace the example role names with the exact values sent by your provider. In the OIDC UI, enter **Roles** and **Admin Roles** one value per line. Leave **Roles** empty if any authenticated user should be allowed to sign in.

```yaml
Enabled: true
EnableAuthorization: true
EnableAllFolders: true
EnabledFolders: []
Roles: ["jellyfin_user"]
AdminRoles: ["jellyfin_admin"]
EnableFolderRoles: false
FolderRoleMapping: []
```

## Authelia

Authelia is simple to configure, and RBAC is straightforward.

### Authelia's Config

Below is the `identity_providers` section of an Authelia config:

### Authelia v4.38 and above

```yaml
identity_providers:
  oidc:
    # hmac secret and private key given by env variables
    clients:
      - client_id: jellyfin
        client_name: My media server
        # Client secret should be randomly generated
        client_secret: <redacted>
        token_endpoint_auth_method: client_secret_post
        authorization_policy: one_factor
        redirect_uris:
          - https://jellyfin.example.com/sso/OID/redirect/authelia
```

### Authelia v4.37 and below

```yaml
identity_providers:
  oidc:
    # hmac secret and private key given by env variables
    clients:
      - id: jellyfin
        description: My media server
        # Client secret should be randomly generated
        secret: <redacted>
        authorization_policy: one_factor
        redirect_uris:
          - https://jellyfin.example.com/sso/OID/redirect/authelia
```

### Jellyfin's Config

On Jellyfin's end, we need to configure an Authelia provider as follows:

In order to test group membership, we need to request Authelia's `groups` OIDC scope, which we will use to check user roles.

```yaml
authelia:
  OidEndpoint: https://authelia.example.com
  OidClientId: jellyfin
  OidSecret: <redacted>
  RoleClaim: groups
  OidScopes: ["groups"]
  DisablePushedAuthorization: true
```

## authentik

Create an OAuth2/OIDC provider and application in authentik, following the [official authentik setup guide](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/create-oauth2-provider/). The last segment of the redirect URI must match **Name of OpenID Provider** in Jellyfin; this example uses `authentik`. Keep another Jellyfin administrator account available while testing RBAC settings.

### authentik's Config

1. In the authentik OAuth2/OIDC provider, use a confidential client with a client secret. Set an exact **Redirect URI** to `https://jellyfin.example.com/sso/OID/redirect/authentik`, replacing the domain and `authentik` with your Jellyfin URL and chosen provider name.
2. Make sure the provider has authentik's default `openid` and `profile` scope mappings. The default [`profile` mapping](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/#default-scopes) supplies the `preferred_username` and `groups` claims. Jellyfin requests both scopes automatically, so the standard setup needs no custom scope mapping.
3. Copy the provider's client ID and client secret for the Jellyfin settings below. With authentik's default per-provider issuer mode, the issuer URL uses the application slug, for example `https://authentik.example.com/application/o/jellyfin/`.

### Jellyfin's Config

In Jellyfin, open the SSO plugin settings from the dashboard and fill in **Add / Update Provider Configuration**:

| UI field                                | Value for this example                                                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name of OpenID Provider                 | `authentik` — must match the last part of the redirect URI exactly.                                                                                                |
| OpenID Endpoint                         | `https://authentik.example.com/application/o/jellyfin/` — replace `jellyfin` with your authentik application slug when using the default per-provider issuer mode. |
| OpenID Client ID / OpenID client secret | The values from the authentik OAuth2/OIDC provider.                                                                                                                |
| Enabled                                 | On.                                                                                                                                                                |
| Enable Authorization by Plugin          | On if Jellyfin should set user permissions from provider roles.                                                                                                    |
| Role Claim                              | `groups` — the claim containing authentik group names.                                                                                                             |
| Roles                                   | Optional: one authentik group name per line. When set, users must match at least one group to sign in.                                                             |
| Admin Roles                             | Optional: one authentik group name per line to grant Jellyfin administrator access when plugin authorization is enabled.                                           |
| Request Additional Scopes               | Leave blank with authentik's default `profile` mapping. The plugin already requests `openid profile`.                                                              |
| Do Not Load Profile Information         | Off, so the plugin reads group claims from authentik's UserInfo endpoint.                                                                                          |

Choose folder access using **Enable All Folders**, **Enabled Folders**, or **Enable Folder Roles** as needed; see [common RBAC settings](#common-rbac-settings). Group names in **Roles** and **Admin Roles** must match authentik's `groups` claim exactly, including capitalization. Save the provider and restart Jellyfin for configuration changes to take effect.

If your authentik provider does not return `groups` through its `profile` mapping, create an [OAuth2/OIDC scope mapping](https://docs.goauthentik.io/add-secure-apps/providers/property-mappings/) with **Scope name** set to `groups` and this expression. Assign the mapping to the authentik provider, then enter `groups` on its own line in Jellyfin's **Request Additional Scopes** field:

```python
return {"groups": [group.name for group in request.user.groups.all()]}
```

If Jellyfin reports `Error loading discovery document: Endpoint belongs to different authority`, check that the **OpenID Endpoint** matches the authentik issuer and that the discovery document's endpoint URLs are reachable from Jellyfin. If authentik intentionally advertises endpoints on a different authority, **Do Not Validate OpenID Endpoints** in the plugin settings bypasses this check.

## Keycloak OIDC

Keycloak in general is a little more complicated than other providers. Ensure that you have a realm created and have some usable users.

### Keycloak's Config

Create a new Keycloak `openid-connect` application. Set the root URL to your Jellyfin URL (ie https://myjellyfin.example.com)

Ensure that the following configuration options are set:

- Access Type: Confidential
- Standard Flow Enabled
- Redirect URI: https://myjellyfin.example.com/sso/OID/redirect/PROVIDER_NAME
- Redirect URI (for Android app): org.jellyfin.mobile://login-callback
- Base URL: https://myjellyfin.example.com

Press the "Save" button at the bottom of the page and open the "Credentials" tab. Note down the secret.

For adding groups and RBAC, go to the "mappers" tab, press "Add Builtin", and select either "Groups", "Realm Roles", or "Client Roles", depending on the role system you are planning on using. Once the mapper is added, edit the mapper and ensure that you note down the Token Claim Name as well as enable all four toggles: "Multivalued", "Add to ID token", "Add to access token", and "Add to userinfo" are enabled.

Note that if you are using the template for the "Client Roles" mapper, the default token claim name has `${client_id}` in it. When noting down this value, make sure you note down the actual Client ID (which should be written above).

### Jellyfin's Config

On Jellyfin's side, we need to configure a Keycloak provider as follows:

```yaml
keycloak:
  OidEndpoint: https://keycloak.example.com/realms/<realm>
  OidClientId: <same-as-in-keycloak>
  OidSecret: <redacted>
  RoleClaim: <same-as-token-claim-name>
```

## Keycloak SAML

Keycloak with SAML is very similar to OpenID. Again, Keycloak in general is a little more complicated than other providers. Ensure that you have a realm created and have some usable users.

### Keycloak's Config

Create a new Keycloak `saml` application. Set the root URL to your Jellyfin URL (ie https://myjellyfin.example.com)

Ensure that the following configuration options are set:

- Sign Documents on
- Sign Assertions off
- Client Signature Required off
- Redirect URI: [https://myjellyfin.example.com/sso/SAML/start/PROVIDER_NAME](https://myjellyfin.example.com/sso/SAML/start/PROVIDER_NAME)
- Base URL: [https://myjellyfin.example.com](https://myjellyfin.example.com)
- Master SAML processing URL: [https://myjellyfin.example.com/sso/SAML/start/PROVIDER_NAME](https://myjellyfin.example.com/sso/SAML/start/PROVIDER_NAME)

Press the "Save" button at the bottom of the page.

For adding groups and RBAC, go to the "mappers" tab, press "Add Builtin", and select either "Groups", "Realm Roles", or "Client Roles", depending on the role system you are planning on using. Once the mapper is added, edit the mapper and ensure that you note down the Token Claim Name as well as enable all four toggles: "Multivalued", "Add to ID token", "Add to access token", and "Add to userinfo" are enabled.

Note that if you are using the template for the "Client Roles" mapper, the default token claim name has `${client_id}` in it. When noting down this value, make sure you note down the actual Client ID (which should be written above).

Finally, download the certificate. Open the "Installation" tab, select "Mod Auth Mellon files", and download the zip. Extract the zip file, and open the `idp-metadata.xml` file. Note down the contents of the `X509Certificate` value.

### Jellyfin's Config

```yaml
keycloak:
  SamlEndpoint: https://keycloak.example.com/realms/<realm>/protocol/saml
  SamlClientId: <same-as-in-keycloak>
  SamlCertificate: <copied-from-xml-file>
```

## Pocket ID

A simple and easy-to-use OIDC provider that allows users to authenticate with their passkeys to your services.

### Pocket ID Config

1. Login to you Pocket ID admin account
1. Go to `Administration -> OCID Clients`
1. Click `Add OCID Client`
1. Give the client a name e.g. `Jellyfin`
1. Set the `Clent Launch URL` to your Jellyfin endpoint
1. Set the callbak url to `https://jellyfin.example.com/sso/OID/redirect/pocketid`. The `pocketid` part must match the `Name of OpenID Provider` in the Jellyfin SSO provider
1. (optional) Enable PKCE if Jellyfin is an https endpoint
1. (optional) Set a logo
1. (optional) Set `Allowed User Groups`

### Jellyfin's Config

```yaml
pocketid:
  OidEndpoint: https://pocketid.example.com/.well-known/openid-configuration
  OidClientId: <pocket-id-client-id>
  OidSecret: <pocket-id-secret>
  EnableAuthorization: true # (optional) If you want Jellyfin to read group permissions from pocket id
  RoleClaim: groups # (optional) If you want Jellyfin to be able to read group assignments from pocket id
  AdminRoles: admin # (optional) The pocket id group which will give a user Jellyfin admin privilges
  Roles: users  # (optional) The pocket id group which will give a user Jellyfin access
  AvatarUrlFormat: @{picture} # (optional) This will pull each users pocket id photo into Jellyfin
```

## Kanidm

Kanidm is a modern and simple identity management platform written in rust.

### Kanidm Config

```shell
kanidm system oauth2 create jellyfin "Jellyfin" https://jellyfin.example.com/

# Set this to drop the trailing @idm.example.com in usernames
kanidm system oauth2 prefer-short-username jellyfin

kanidm system oauth2 add-redirect-url jellyfin https://jellyfin.example.com/sso/OID/redirect/kanidm
kanidm system oauth2 add-redirect-url jellyfin https://jellyfin.example.com/sso/OID/r/kanidm

# Optionally setup groups for Jellyfin
kanidm group create jellyfin_admins
kanidm group create jellyfin_users

kanidm system oauth2 update-scope-map jellyfin jellyfin_admins openid profile groups
kanidm system oauth2 update-scope-map jellyfin jellyfin_users openid profile groups
```

Get the secret used in the Jellyfin config with `kanidm system oauth2 show-basic-secret jellyfin`.

### Jellyfin's Config

```yaml
kanidm:
  OidEndpoint: https://idm.example.com/oauth2/openid/jellyfin/
  OidClientId: jellyfin
  OidSecret: <kanidm-secret>
  # (optional) If you want Jellyfin to read group permissions from kanidm
  EnableAuthorization: true
  OidScopes:
    - groups
  RoleClaim: groups
  AdminsRoles:
    - jellyfin_admins@idm.example.com
  Roles:
    - jellyfin_users@idm.example.com
    # If in your setup admin accounts aren't members of the users group you need to add the admins group to roles as well
    - jellyfin_admins@idm.example.com
  # (optional) If you want the name attribute instead of the spn attribute as username
  DefaultUsernameClaim: preferred_username
```
