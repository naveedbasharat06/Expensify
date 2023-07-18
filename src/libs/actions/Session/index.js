import Onyx from 'react-native-onyx';
import _ from 'underscore';
import lodashGet from 'lodash/get';
import {Linking} from 'react-native';
import clearCache from './clearCache';
import ONYXKEYS from '../../../ONYXKEYS';
import redirectToSignIn from '../SignInRedirect';
import CONFIG from '../../../CONFIG';
import Log from '../../Log';
import PushNotification from '../../Notification/PushNotification';
import Timing from '../Timing';
import CONST from '../../../CONST';
import * as Localize from '../../Localize';
import Timers from '../../Timers';
import * as Pusher from '../../Pusher/pusher';
import * as Authentication from '../../Authentication';
import * as Welcome from '../Welcome';
import * as API from '../../API';
import * as NetworkStore from '../../Network/NetworkStore';
import Navigation from '../../Navigation/Navigation';
import * as Device from '../Device';
import subscribeToReportCommentPushNotifications from '../../Notification/PushNotification/subscribeToReportCommentPushNotifications';
import ROUTES from '../../../ROUTES';
import * as ErrorUtils from '../../ErrorUtils';
import * as ReportUtils from '../../ReportUtils';
import * as Report from '../Report';
import {hideContextMenu} from '../../../pages/home/report/ContextMenu/ReportActionContextMenu';

let authTokenType = '';
Onyx.connect({
    key: ONYXKEYS.SESSION,
    callback: (session) => (authTokenType = lodashGet(session, 'authTokenType')),
});

let credentials = {};
Onyx.connect({
    key: ONYXKEYS.CREDENTIALS,
    callback: (val) => (credentials = val || {}),
});

/**
 * Manage push notification subscriptions on sign-in/sign-out.
 *
 * On Android, AuthScreens unmounts when the app is closed with the back button so we manage the
 * push subscription when the session changes here.
 */
Onyx.connect({
    key: ONYXKEYS.NVP_PRIVATE_PUSH_NOTIFICATION_ID,
    callback: (notificationID) => {
        if (notificationID) {
            PushNotification.register(notificationID);

            // Prevent issue where report linking fails after users switch accounts without closing the app
            PushNotification.init();
            subscribeToReportCommentPushNotifications();
        } else {
            PushNotification.deregister();
            PushNotification.clearNotifications();
        }
    },
});

/**
 * Clears the Onyx store and redirects user to the sign in page
 */
function signOut() {
    Log.info('Flushing logs before signing out', true, {}, true);

    API.write('LogOut', {
        // Send current authToken because we will immediately clear it once triggering this command
        authToken: NetworkStore.getAuthToken(),
        partnerUserID: lodashGet(credentials, 'autoGeneratedLogin', ''),
        partnerName: CONFIG.EXPENSIFY.PARTNER_NAME,
        partnerPassword: CONFIG.EXPENSIFY.PARTNER_PASSWORD,
        shouldRetry: false,
    });
    clearCache().then(() => {
        Log.info('Cleared all chache data', true, {}, true);
    });
    Timing.clearData();
}

/**
 * Checks if the account is an anonymous account.
 *
 * @return {boolean}
 */
function isAnonymousUser() {
    return authTokenType === 'anonymousAccount';
}

function signOutAndRedirectToSignIn() {
    hideContextMenu(false);
    signOut();
    redirectToSignIn();
    Log.info('Redirecting to Sign In because signOut() was called');
    if (isAnonymousUser()) {
        Linking.getInitialURL().then((url) => {
            const reportID = ReportUtils.getReportIDFromLink(url);
            if (reportID) {
                Report.setLastOpenedPublicRoom(reportID);
            }
        });
    }
}

/**
 * @param {Function} callback The callback to execute if the action is allowed
 * @param {Boolean} isAnonymousAction The action is allowed for anonymous or not
 * @returns {Function} same callback if the action is allowed, otherwise a function that signs out and redirects to sign in
 */
function checkIfActionIsAllowed(callback, isAnonymousAction = false) {
    if (isAnonymousUser() && !isAnonymousAction) {
        return () => signOutAndRedirectToSignIn();
    }
    return callback;
}

/**
 * Resend the validation link to the user that is validating their account
 *
 * @param {String} [login]
 */
function resendValidationLink(login = credentials.login) {
    const optimisticData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                isLoading: true,
                errors: null,
                message: null,
                loadingForm: CONST.FORMS.RESEND_VALIDATION_FORM,
            },
        },
    ];
    const successData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                isLoading: false,
                message: 'resendValidationForm.linkHasBeenResent',
                loadingForm: null,
            },
        },
    ];
    const failureData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                isLoading: false,
                message: null,
                loadingForm: null,
            },
        },
    ];

    API.write('RequestAccountValidationLink', {email: login}, {optimisticData, successData, failureData});
}

/**
 * Request a new validate / magic code for user to sign in via passwordless flow
 *
 * @param {String} [login]
 */
function resendValidateCode(login = credentials.login) {
    const optimisticData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                errors: null,
                loadingForm: CONST.FORMS.RESEND_VALIDATE_CODE_FORM,
            },
        },
    ];
    const successData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                loadingForm: null,
            },
        },
    ];
    const failureData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                loadingForm: null,
            },
        },
    ];
    API.write('RequestNewValidateCode', {email: login}, {optimisticData, successData, failureData});
}

/**
 * Constructs the state object for the BeginSignIn && BeginAppleSignIn API calls.
 *  @returns {Object}
 */

function signInAttemptState() {
    return {
        optimisticData: [
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: ONYXKEYS.ACCOUNT,
                value: {
                    ...CONST.DEFAULT_ACCOUNT_DATA,
                    isLoading: true,
                    message: null,
                    loadingForm: CONST.FORMS.LOGIN_FORM,
                },
            },
        ],
        successData: [
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: ONYXKEYS.ACCOUNT,
                value: {
                    isLoading: false,
                    loadingForm: null,
                },
            },
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: ONYXKEYS.CREDENTIALS,
                value: {
                    validateCode: null,
                },
            },
        ],
        failureData: [
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: ONYXKEYS.ACCOUNT,
                value: {
                    isLoading: false,
                    loadingForm: null,
                    // eslint-disable-next-line rulesdir/prefer-localization
                    errors: ErrorUtils.getMicroSecondOnyxError('loginForm.cannotGetAccountDetails'),
                },
            },
        ],
    };
}

/**
 * Checks the API to see if an account exists for the given login.
 *
 * @param {String} login
 */

function beginSignIn(login) {
    const {optimisticData, successData, failureData} = signInAttemptState();
    API.read('BeginSignIn', {email: login}, {optimisticData, successData, failureData});
}

/**
 * Given an idToken from Sign in with Apple, checks the API to see if an account
 * exists for that email address and signs the user in if so.
 *
 * @param {String} idToken
 */

function beginAppleSignIn(idToken) {
    const {optimisticData, successData, failureData} = signInAttemptState();
    API.write('SignInWithApple', {idToken}, {optimisticData, successData, failureData});
}

/**
 * Shows Google sign-in process, and if an auth token is successfully obtained,
 * passes the token on to the Expensify API to sign in with
 *
 * @param {String} token
 */
function beginGoogleSignIn(token) {
    const {optimisticData, successData, failureData} = signInAttemptState();
    API.write('SignInWithGoogle', {token}, {optimisticData, successData, failureData});
}

/**
 * Will create a temporary login for the user in the passed authenticate response which is used when
 * re-authenticating after an authToken expires.
 *
 * @param {String} email
 * @param {String} authToken
 */
function signInWithShortLivedAuthToken(email, authToken) {
    const optimisticData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                ...CONST.DEFAULT_ACCOUNT_DATA,
                isLoading: true,
            },
        },
    ];

    const successData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                isLoading: false,
            },
        },
    ];

    const failureData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                isLoading: false,
            },
        },
    ];

    // If the user is signing in with a different account from the current app, should not pass the auto-generated login as it may be tied to the old account.
    // scene 1: the user is transitioning to newDot from a different account on oldDot.
    // scene 2: the user is transitioning to desktop app from a different account on web app.
    const oldPartnerUserID = credentials.login === email ? credentials.autoGeneratedLogin : '';
    API.read('SignInWithShortLivedAuthToken', {authToken, oldPartnerUserID, skipReauthentication: true}, {optimisticData, successData, failureData});
}

/**
 * Sign the user into the application. This will first authenticate their account
 * then it will create a temporary login for them which is used when re-authenticating
 * after an authToken expires.
 *
 * @param {String} validateCode 6 digit code required for login
 * @param {String} [twoFactorAuthCode]
 * @param {String} [preferredLocale] Indicates which language to use when the user lands in the app
 */
function signIn(validateCode, twoFactorAuthCode, preferredLocale = CONST.LOCALES.DEFAULT) {
    const optimisticData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                ...CONST.DEFAULT_ACCOUNT_DATA,
                isLoading: true,
                loadingForm: twoFactorAuthCode ? CONST.FORMS.VALIDATE_TFA_CODE_FORM : CONST.FORMS.VALIDATE_CODE_FORM,
            },
        },
    ];

    const successData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                isLoading: false,
                loadingForm: null,
            },
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.CREDENTIALS,
            value: {
                validateCode,
            },
        },
    ];

    const failureData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                isLoading: false,
                loadingForm: null,
            },
        },
    ];

    const params = {
        twoFactorAuthCode,
        email: credentials.login,
        preferredLocale,
    };

    // Conditionally pass a password or validateCode to command since we temporarily allow both flows
    if (validateCode || twoFactorAuthCode) {
        params.validateCode = validateCode || credentials.validateCode;
    }
    Device.getDeviceInfoWithID().then((deviceInfo) => {
        API.write('SigninUser', {...params, deviceInfo}, {optimisticData, successData, failureData});
    });
}

function signInWithValidateCode(accountID, code, preferredLocale = CONST.LOCALES.DEFAULT, twoFactorAuthCode = '') {
    // If this is called from the 2fa step, get the validateCode directly from onyx
    // instead of the one passed from the component state because the state is changing when this method is called.
    const validateCode = twoFactorAuthCode ? credentials.validateCode : code;

    const optimisticData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                ...CONST.DEFAULT_ACCOUNT_DATA,
                isLoading: true,
                loadingForm: twoFactorAuthCode ? CONST.FORMS.VALIDATE_TFA_CODE_FORM : CONST.FORMS.VALIDATE_CODE_FORM,
            },
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.SESSION,
            value: {autoAuthState: CONST.AUTO_AUTH_STATE.SIGNING_IN},
        },
    ];

    const successData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                isLoading: false,
                loadingForm: null,
            },
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.CREDENTIALS,
            value: {
                accountID,
                validateCode,
            },
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.SESSION,
            value: {autoAuthState: CONST.AUTO_AUTH_STATE.JUST_SIGNED_IN},
        },
    ];

    const failureData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                isLoading: false,
                loadingForm: null,
            },
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.SESSION,
            value: {autoAuthState: CONST.AUTO_AUTH_STATE.FAILED},
        },
    ];
    Device.getDeviceInfoWithID().then((deviceInfo) => {
        API.write(
            'SigninUserWithLink',
            {
                accountID,
                validateCode,
                twoFactorAuthCode,
                preferredLocale,
                deviceInfo,
            },
            {optimisticData, successData, failureData},
        );
    });
}

function signInWithValidateCodeAndNavigate(accountID, validateCode, preferredLocale = CONST.LOCALES.DEFAULT, twoFactorAuthCode = '') {
    signInWithValidateCode(accountID, validateCode, preferredLocale, twoFactorAuthCode);
    Navigation.navigate(ROUTES.HOME);
}

/**
 * Initializes the state of the automatic authentication when the user clicks on a magic link.
 *
 * This method is called in componentDidMount event of the lifecycle.
 * When the user gets authenticated, the component is unmounted and then remounted
 * when AppNavigator switches from PublicScreens to AuthScreens.
 * That's the reason why autoAuthState initialization is skipped while the last state is SIGNING_IN.
 *
 * @param {string} cachedAutoAuthState
 */
function initAutoAuthState(cachedAutoAuthState) {
    Onyx.merge(ONYXKEYS.SESSION, {
        autoAuthState: _.contains([CONST.AUTO_AUTH_STATE.SIGNING_IN, CONST.AUTO_AUTH_STATE.JUST_SIGNED_IN], cachedAutoAuthState)
            ? CONST.AUTO_AUTH_STATE.JUST_SIGNED_IN
            : CONST.AUTO_AUTH_STATE.NOT_STARTED,
    });
}

function invalidateCredentials() {
    Onyx.merge(ONYXKEYS.CREDENTIALS, {autoGeneratedLogin: '', autoGeneratedPassword: ''});
}

function invalidateAuthToken() {
    NetworkStore.setAuthToken('pizza');
    Onyx.merge(ONYXKEYS.SESSION, {authToken: 'pizza'});
}

/**
 * Sets the SupportToken
 * @param {String} supportToken
 * @param {String} email
 * @param {Number} accountID
 */
function setSupportAuthToken(supportToken, email, accountID) {
    if (supportToken) {
        Onyx.merge(ONYXKEYS.SESSION, {
            authToken: '1',
            supportAuthToken: supportToken,
            email,
            accountID,
        });
    } else {
        Onyx.set(ONYXKEYS.SESSION, {});
    }
    NetworkStore.setSupportAuthToken(supportToken);
}

/**
 * Clear the credentials and partial sign in session so the user can taken back to first Login step
 */
function clearSignInData() {
    Onyx.multiSet({
        [ONYXKEYS.ACCOUNT]: null,
        [ONYXKEYS.CREDENTIALS]: {},
    });
}

/**
 * Put any logic that needs to run when we are signed out here. This can be triggered when the current tab or another tab signs out.
 */
function cleanupSession() {
    Pusher.disconnect();
    Timers.clearAll();
    Welcome.resetReadyCheck();
}

function clearAccountMessages() {
    Onyx.merge(ONYXKEYS.ACCOUNT, {
        success: '',
        errors: null,
        message: null,
        isLoading: false,
    });
}

// It's necessary to throttle requests to reauthenticate since calling this multiple times will cause Pusher to
// reconnect each time when we only need to reconnect once. This way, if an authToken is expired and we try to
// subscribe to a bunch of channels at once we will only reauthenticate and force reconnect Pusher once.
const reauthenticatePusher = _.throttle(
    () => {
        Log.info('[Pusher] Re-authenticating and then reconnecting');
        Authentication.reauthenticate('AuthenticatePusher')
            .then(Pusher.reconnect)
            .catch(() => {
                console.debug('[PusherConnectionManager]', 'Unable to re-authenticate Pusher because we are offline.');
            });
    },
    5000,
    {trailing: false},
);

/**
 * @param {String} socketID
 * @param {String} channelName
 * @param {Function} callback
 */
function authenticatePusher(socketID, channelName, callback) {
    Log.info('[PusherAuthorizer] Attempting to authorize Pusher', false, {channelName});

    // We use makeRequestWithSideEffects here because we need to authorize to Pusher (an external service) each time a user connects to any channel.
    // eslint-disable-next-line rulesdir/no-api-side-effects-method
    API.makeRequestWithSideEffects('AuthenticatePusher', {
        socket_id: socketID,
        channel_name: channelName,
        shouldRetry: false,
        forceNetworkRequest: true,
    })
        .then((response) => {
            if (response.jsonCode === CONST.JSON_CODE.NOT_AUTHENTICATED) {
                Log.hmmm('[PusherAuthorizer] Unable to authenticate Pusher because authToken is expired');
                callback(new Error('Pusher failed to authenticate because authToken is expired'), {auth: ''});

                // Attempt to refresh the authToken then reconnect to Pusher
                reauthenticatePusher();
                return;
            }

            if (response.jsonCode !== CONST.JSON_CODE.SUCCESS) {
                Log.hmmm('[PusherAuthorizer] Unable to authenticate Pusher for reason other than expired session');
                callback(new Error(`Pusher failed to authenticate because code: ${response.jsonCode} message: ${response.message}`), {auth: ''});
                return;
            }

            Log.info('[PusherAuthorizer] Pusher authenticated successfully', false, {channelName});
            callback(null, response);
        })
        .catch((error) => {
            Log.hmmm('[PusherAuthorizer] Unhandled error: ', {channelName, error});
            callback(new Error('AuthenticatePusher request failed'), {auth: ''});
        });
}

/**
 * Request a new validation link / magic code to unlink an unvalidated secondary login from a primary login
 */
function requestUnlinkValidationLink() {
    const optimisticData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                isLoading: true,
                errors: null,
                message: null,
                loadingForm: CONST.FORMS.UNLINK_LOGIN_FORM,
            },
        },
    ];
    const successData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                isLoading: false,
                message: 'unlinkLoginForm.linkSent',
                loadingForm: null,
            },
        },
    ];
    const failureData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                isLoading: false,
                loadingForm: null,
            },
        },
    ];

    API.write('RequestUnlinkValidationLink', {email: credentials.login}, {optimisticData, successData, failureData});
}

function unlinkLogin(accountID, validateCode) {
    const optimisticData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                ...CONST.DEFAULT_ACCOUNT_DATA,
                isLoading: true,
            },
        },
    ];
    const successData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                isLoading: false,
                message: Localize.translateLocal('unlinkLoginForm.succesfullyUnlinkedLogin'),
            },
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.CREDENTIALS,
            value: {
                login: '',
            },
        },
    ];
    const failureData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                isLoading: false,
            },
        },
    ];

    API.write(
        'UnlinkLogin',
        {
            accountID,
            validateCode,
        },
        {
            optimisticData,
            successData,
            failureData,
        },
    );
}

/**
 * Toggles two-factor authentication based on the `enable` parameter
 *
 * @param {Boolean} enable
 */
function toggleTwoFactorAuth(enable) {
    const optimisticData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                isLoading: true,
            },
        },
    ];

    const successData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                isLoading: false,
            },
        },
    ];

    const failureData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                isLoading: false,
            },
        },
    ];

    API.write(enable ? 'EnableTwoFactorAuth' : 'DisableTwoFactorAuth', {}, {optimisticData, successData, failureData});
}

function validateTwoFactorAuth(twoFactorAuthCode) {
    const optimisticData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                isLoading: true,
            },
        },
    ];

    const successData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                isLoading: false,
            },
        },
    ];

    const failureData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                isLoading: false,
            },
        },
    ];

    API.write('TwoFactorAuth_Validate', {twoFactorAuthCode}, {optimisticData, successData, failureData});
}

export {
    beginSignIn,
    beginAppleSignIn,
    beginGoogleSignIn,
    setSupportAuthToken,
    checkIfActionIsAllowed,
    signIn,
    signInWithValidateCode,
    signInWithValidateCodeAndNavigate,
    initAutoAuthState,
    signInWithShortLivedAuthToken,
    cleanupSession,
    signOut,
    signOutAndRedirectToSignIn,
    resendValidationLink,
    resendValidateCode,
    requestUnlinkValidationLink,
    unlinkLogin,
    clearSignInData,
    clearAccountMessages,
    authenticatePusher,
    reauthenticatePusher,
    invalidateCredentials,
    invalidateAuthToken,
    isAnonymousUser,
    toggleTwoFactorAuth,
    validateTwoFactorAuth,
};
