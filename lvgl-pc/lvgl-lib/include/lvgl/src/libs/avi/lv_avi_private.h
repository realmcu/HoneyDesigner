/**
 * @file lv_avi_private.h
 *
 */

#ifndef LV_AVI_PRIVATE_H
#define LV_AVI_PRIVATE_H

#ifdef __cplusplus
extern "C" {
#endif

/*********************
 *      INCLUDES
 *********************/

#include "../../widgets/image/lv_image_private.h"
#include "lv_avi.h"

#if LV_USE_AVI

/*********************
 *      DEFINES
 *********************/

/**********************
 *      TYPEDEFS
 **********************/

/**********************
 *      TYPEDEFS
 **********************/

typedef struct {
    lv_image_t img;
    ad_AVI * avi;
    lv_timer_t * timer;
    lv_image_dsc_t imgdsc;
    uint32_t last_call;
}lv_avi_t;

/**********************
 * GLOBAL PROTOTYPES
 **********************/

/**********************
 *      MACROS
 **********************/

#endif /* LV_USE_AVI */

#ifdef __cplusplus
} /*extern "C"*/
#endif

#endif /*LV_AVI_PRIVATE_H*/
